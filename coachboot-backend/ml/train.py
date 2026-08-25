#!/usr/bin/env python3
# =============================================================================
# COACHBOOT IA — ENTRAÎNEMENT (pipeline réel, pas simulé)
#
# Données joueurs → nettoyage → normalisation → feature engineering →
# split train/validation/test → RandomForest (scikit-learn) → évaluation
# sur le test set (jamais vu pendant l'entraînement) → modèle sauvegardé.
#
# Appelé par coachboot-backend/src/routes/ml.routes.js via child_process,
# un run de training = un process Python qui se termine (pas un service
# qui tourne en continu — voir la décision d'architecture dans docs/API.md).
#
# Toute la sortie de progression va sur stderr ; la DERNIÈRE ligne de stdout
# est un unique blob JSON (résultat), pour que Node puisse le parser
# sans ambiguïté même si scikit-learn émet des warnings.
# =============================================================================
import argparse
import json
import os
import sys
from datetime import datetime, timezone

# Force l'UTF-8 sur stdout/stderr : sans ça, la console Windows par défaut
# (cp1252) tronque ou plante sur les accents français dans les logs et les
# messages d'erreur JSON (ex. « Colonnes absentes », « écartée(s) »).
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import (
    accuracy_score, f1_score, mean_absolute_error,
    mean_squared_error, r2_score, confusion_matrix,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler

# Statistiques football "comptées" pour lesquelles une normalisation par 90
# minutes jouées est une pratique standard en analyse de performance —
# évite qu'un joueur qui a simplement plus joué paraisse "meilleur".
COUNT_LIKE_STATS = {
    'distance_totale', 'sprints', 'accelerations', 'decelerations',
    'passes', 'tirs', 'buts', 'assists', 'interceptions', 'duels', 'recuperations',
}


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def engineer_features(df, features, minutes_col):
    """Ajoute, quand c'est pertinent, une version 'par 90 minutes' des stats
    de comptage sélectionnées — vraie feature engineering, pas cosmétique."""
    engineered = list(features)
    if minutes_col and minutes_col in df.columns:
        minutes_safe = df[minutes_col].replace(0, np.nan)
        for f in features:
            if f in COUNT_LIKE_STATS and f != minutes_col:
                new_col = f'{f}_par_90'
                df[new_col] = (df[f] / minutes_safe) * 90
                engineered.append(new_col)
    return df, engineered


def main():
    parser = argparse.ArgumentParser(description='Entraîne un modèle CoachBoot IA sur un CSV de données joueurs.')
    parser.add_argument('--csv', required=True)
    parser.add_argument('--features', required=True, help='Liste de colonnes séparées par des virgules')
    parser.add_argument('--target', required=True)
    parser.add_argument('--task', required=True, choices=['regression', 'classification'])
    parser.add_argument('--model-id', required=True)
    parser.add_argument('--models-dir', required=True)
    parser.add_argument('--dataset-type', default='unknown', choices=['synthetic', 'real', 'unknown'],
                         help="Déclaré par l'utilisateur au moment de l'upload — jamais déduit "
                              "automatiquement, pour ne jamais présenter un jeu de données "
                              "synthétique comme des statistiques de match réelles.")
    args = parser.parse_args()

    features = [f.strip() for f in args.features.split(',') if f.strip()]
    target = args.target.strip()

    log(f'→ Lecture de {args.csv}')
    df = pd.read_csv(args.csv)
    row_count_raw = len(df)

    missing_cols = [c for c in features + [target] if c not in df.columns]
    if missing_cols:
        print(json.dumps({'error': f"Colonnes absentes du CSV : {', '.join(missing_cols)}"}))
        sys.exit(1)

    # ---- Nettoyage : coercition numérique des features (toujours) et de la
    # cible (seulement en régression — en classification la cible peut être
    # une étiquette texte), puis suppression des lignes incomplètes/dupliquées ----
    for c in features:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    if args.task == 'regression':
        df[target] = pd.to_numeric(df[target], errors='coerce')

    df = df.dropna(subset=features + [target]).drop_duplicates()
    row_count_clean = len(df)
    dropped = row_count_raw - row_count_clean
    log(f'→ Nettoyage : {dropped} ligne(s) écartée(s) (valeurs manquantes/dupliquées), {row_count_clean} restantes.')

    if row_count_clean < 20:
        print(json.dumps({'error': f"Trop peu de lignes exploitables après nettoyage ({row_count_clean}). Il en faut au moins 20 pour un split train/val/test significatif."}))
        sys.exit(1)

    # ---- Feature engineering (par 90 minutes quand pertinent) ----
    minutes_col = 'minutes_jouees' if 'minutes_jouees' in df.columns else None
    df, features_eng = engineer_features(df, features, minutes_col)
    log(f'→ Features finales ({len(features_eng)}) : {features_eng}')

    X = df[features_eng].values
    y_raw = df[target]

    label_classes = None
    if args.task == 'classification':
        encoder = LabelEncoder()
        y = encoder.fit_transform(y_raw)
        label_classes = [str(c) for c in encoder.classes_]
    else:
        y = y_raw.values

    # ---- Split train / validation / test (70 / 15 / 15) — le test set n'est
    # touché qu'une seule fois, à l'évaluation finale. En classification,
    # stratifié pour que chaque classe soit représentée dans les trois splits
    # (sinon une classe rare peut disparaître du train set sur un petit jeu de
    # données, et le modèle ne peut alors ni l'apprendre ni la prédire). ----
    try:
        stratify_main = y if args.task == 'classification' else None
        X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.3, random_state=42, stratify=stratify_main)
        stratify_temp = y_temp if args.task == 'classification' else None
        X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.5, random_state=42, stratify=stratify_temp)
    except ValueError:
        # Une classe a trop peu d'échantillons pour être stratifiée sur les 3 splits
        # (ex. 1 seul exemple) — on retombe sur un split aléatoire simple plutôt que
        # de planter, au prix d'un risque qu'une classe rare soit sous-représentée.
        log('→ Stratification impossible (classe trop rare) : split aléatoire simple utilisé à la place.')
        X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.3, random_state=42)
        X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.5, random_state=42)
    log(f'→ Split : train={len(X_train)}  val={len(X_val)}  test={len(X_test)}')

    # ---- Normalisation : le scaler est calé UNIQUEMENT sur le train set,
    # pour ne pas laisser fuiter d'information du val/test set. ----
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_val_s = scaler.transform(X_val)
    X_test_s = scaler.transform(X_test)

    # ---- Entraînement ----
    log(f'→ Entraînement RandomForest ({args.task})…')
    if args.task == 'regression':
        model = RandomForestRegressor(n_estimators=300, max_depth=None, random_state=42, n_jobs=-1)
    else:
        model = RandomForestClassifier(n_estimators=300, max_depth=None, random_state=42, n_jobs=-1)
    model.fit(X_train_s, y_train)

    # ---- Évaluation sur le TEST set (jamais vu à l'entraînement) ----
    y_pred_test = model.predict(X_test_s)
    y_pred_val = model.predict(X_val_s)

    if args.task == 'regression':
        metrics = {
            'test': {
                'rmse': float(np.sqrt(mean_squared_error(y_test, y_pred_test))),
                'mae': float(mean_absolute_error(y_test, y_pred_test)),
                'r2': float(r2_score(y_test, y_pred_test)),
            },
            'validation': {
                'rmse': float(np.sqrt(mean_squared_error(y_val, y_pred_val))),
                'mae': float(mean_absolute_error(y_val, y_pred_val)),
                'r2': float(r2_score(y_val, y_pred_val)),
            },
        }
    else:
        metrics = {
            'test': {
                'accuracy': float(accuracy_score(y_test, y_pred_test)),
                'f1_weighted': float(f1_score(y_test, y_pred_test, average='weighted', zero_division=0)),
                'confusion_matrix': confusion_matrix(y_test, y_pred_test).tolist(),
            },
            'validation': {
                'accuracy': float(accuracy_score(y_val, y_pred_val)),
                'f1_weighted': float(f1_score(y_val, y_pred_val, average='weighted', zero_division=0)),
            },
        }

    feature_importances = sorted(
        [{'feature': f, 'importance': float(imp)} for f, imp in zip(features_eng, model.feature_importances_)],
        key=lambda x: x['importance'], reverse=True,
    )

    # ---- Sauvegarde du modèle (poids + scaler + métadonnées nécessaires à predict.py) ----
    trained_at = datetime.now(timezone.utc).isoformat()
    model_dir = os.path.join(args.models_dir, args.model_id)
    os.makedirs(model_dir, exist_ok=True)
    bundle = {
        'model': model,
        'scaler': scaler,
        'task': args.task,
        'features_raw': features,
        'features_engineered': features_eng,
        'minutes_col': minutes_col,
        'target': target,
        'label_classes': label_classes,
        'dataset_type': args.dataset_type,
        'trained_at': trained_at,
        'model_id': args.model_id,
    }
    joblib.dump(bundle, os.path.join(model_dir, 'model.joblib'))
    log(f'→ Modèle sauvegardé : {model_dir}/model.joblib')

    result = {
        'model_id': args.model_id,
        'task': args.task,
        'target': target,
        'features': features_eng,
        'row_count_raw': row_count_raw,
        'row_count_clean': row_count_clean,
        'rows_dropped': dropped,
        'split': {'train': len(X_train), 'validation': len(X_val), 'test': len(X_test)},
        'metrics': metrics,
        'feature_importances': feature_importances,
        'label_classes': label_classes,
        'dataset_type': args.dataset_type,
        'trained_at': trained_at,
    }
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — on renvoie l'erreur en JSON exploitable par Node, pas une trace brute
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
