#!/usr/bin/env python3
# =============================================================================
# COACHBOOT IA — PRÉDICTION
# Charge un modèle déjà entraîné (train.py) et produit une prédiction pour
# un joueur/une ligne de données donnée. Un run = un process qui se termine,
# appelé par src/routes/ml.routes.js (POST /api/ml/predict).
# =============================================================================
import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

import joblib
import numpy as np

from train import COUNT_LIKE_STATS  # réutilise exactement la même logique de feature engineering qu'à l'entraînement


def main():
    parser = argparse.ArgumentParser(description="Prédit avec un modèle CoachBoot IA déjà entraîné.")
    parser.add_argument('--model-id', required=True)
    parser.add_argument('--models-dir', required=True)
    parser.add_argument('--input', required=True, help='JSON des valeurs brutes de features (ex: {"distance_totale": 10.5, ...})')
    args = parser.parse_args()

    bundle_path = os.path.join(args.models_dir, args.model_id, 'model.joblib')
    if not os.path.exists(bundle_path):
        print(json.dumps({'error': f'Modèle introuvable : {args.model_id}'}))
        sys.exit(1)

    bundle = joblib.load(bundle_path)
    raw_input = json.loads(args.input)

    missing = [f for f in bundle['features_raw'] if f not in raw_input]
    if missing:
        print(json.dumps({'error': f"Valeurs manquantes pour : {', '.join(missing)}"}))
        sys.exit(1)

    # Reconstruit exactement les mêmes colonnes engineered (ex: *_par_90) que celles
    # vues à l'entraînement, dans le même ordre — indispensable pour que le scaler
    # et le modèle reçoivent un vecteur cohérent avec ce sur quoi ils ont appris.
    minutes_col = bundle.get('minutes_col')
    row = dict(raw_input)
    for f in bundle['features_engineered']:
        if f in row:
            continue
        base = f[:-len('_par_90')] if f.endswith('_par_90') else None
        if base and base in COUNT_LIKE_STATS and minutes_col and minutes_col in row and row[minutes_col]:
            row[f] = (float(row[base]) / float(row[minutes_col])) * 90
        else:
            print(json.dumps({'error': f"Impossible de reconstruire la feature dérivée « {f} »."}))
            sys.exit(1)

    X = np.array([[float(row[f]) for f in bundle['features_engineered']]])
    X_scaled = bundle['scaler'].transform(X)

    model = bundle['model']
    prediction = model.predict(X_scaled)[0]

    # Toute prédiction doit être accompagnée de sa provenance — jamais un chiffre
    # nu : quel modèle exact (model_version = l'ID du modèle, chaque entraînement
    # produit un artefact distinct plutôt qu'incrémenter un numéro de version),
    # sur quel type de données il a appris, quand il a été entraîné, quand cette
    # prédiction a été calculée. `.get(...)` avec repli 'unknown'/None : les
    # modèles entraînés avant l'ajout de ce champ n'ont pas encore ces clés.
    result = {
        'model_id': args.model_id,
        'model_version': bundle.get('model_id', args.model_id),
        'target': bundle['target'],
        'data_source': bundle.get('dataset_type', 'unknown'),
        'model_trained_at': bundle.get('trained_at'),
        'predicted_at': datetime.now(timezone.utc).isoformat(),
    }

    if bundle['task'] == 'regression':
        # Incertitude estimée par la dispersion des prédictions individuelles des
        # arbres de la forêt — une vraie mesure dérivée du modèle, pas inventée.
        tree_preds = np.array([t.predict(X_scaled)[0] for t in model.estimators_])
        result['prediction'] = float(prediction)
        result['uncertainty_std'] = float(tree_preds.std())
    else:
        classes = bundle['label_classes']
        result['prediction'] = classes[int(prediction)] if classes else str(prediction)
        if hasattr(model, 'predict_proba') and classes:
            proba = model.predict_proba(X_scaled)[0]
            # model.classes_ contient les classes réellement vues par le modèle à
            # l'entraînement (pas forcément toutes celles du LabelEncoder — une classe
            # rare peut être absente du train set sur un petit jeu de données) : on
            # mappe donc chaque probabilité via son propre indice de classe encodée,
            # plutôt que de supposer que proba[i] correspond à classes[i].
            result['probabilities'] = {classes[int(c)]: float(p) for c, p in zip(model.classes_, proba)}

    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
