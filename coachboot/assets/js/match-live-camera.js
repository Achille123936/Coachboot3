/* ==========================================================================
   COACHBOOT ENTERPRISE — MATCH LIVE : CAMÉRA (MediaDevices API)
   Contrôle une balise <video> avec la caméra locale de l'appareil (webcam ou
   caméra de smartphone via navigator.mediaDevices.getUserMedia) : démarrer,
   mettre en pause, arrêter, capturer une image instantanée. Propose aussi un
   repli « flux réseau » (URL vidéo directe) pour une caméra IP/enregistreur
   qui expose un flux HLS/MP4 lisible nativement par <video> — un vrai pont
   WebRTC pair-à-pair vers une caméra IP RTSP nécessiterait un serveur de
   signalisation/media (Janus, mediamtx...) hors du périmètre d'un frontend
   statique, voir docs/API.md pour le détail honnête de cette limite.

   Events (sur `window`) : 'cbcam:start', 'cbcam:pause', 'cbcam:resume',
   'cbcam:stop', 'cbcam:capture' (detail = { dataUrl }), 'cbcam:error'
   (detail = { message }).
   ========================================================================== */
(function () {
  let videoEl = null;
  let stream = null;
  let status = 'idle'; // idle | live | paused
  let source = null;   // 'device' | 'network'

  function emit(type, extra) {
    window.dispatchEvent(new CustomEvent(type, { detail: Object.assign({ status, source }, extra) }));
  }

  function friendlyError(err) {
    return {
      NotAllowedError: "Autorisation caméra refusée. Activez-la dans les réglages du navigateur.",
      NotFoundError: "Aucune caméra détectée sur cet appareil.",
      NotReadableError: "La caméra est déjà utilisée par une autre application.",
      OverconstrainedError: "Aucune caméra ne correspond aux réglages demandés (résolution/orientation).",
      SecurityError: "Accès caméra bloqué : nécessite une connexion sécurisée (https/localhost).",
    }[err.name] || err.message || "Impossible d'accéder à la caméra.";
  }

  const CBMatchCamera = {
    isSupported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    getStatus() { return status; },
    getSource() { return source; },
    isLive() { return status === 'live'; },

    /** Attache la balise <video> qui affichera le flux (à appeler une seule fois). */
    attach(el) { videoEl = el; },

    /** Liste les caméras disponibles (webcam intégrée, USB, avant/arrière sur mobile). */
    async listDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(d => d.kind === 'videoinput');
      } catch {
        return [];
      }
    },

    /** Démarre la caméra locale (webcam ou caméra de smartphone). */
    async start({ deviceId, facingMode } = {}) {
      if (!this.isSupported()) {
        emit('cbcam:error', { message: "L'API caméra (MediaDevices) n'est pas disponible sur ce navigateur." });
        return false;
      }
      if (!videoEl) {
        emit('cbcam:error', { message: 'Aucun élément vidéo attaché (CBMatchCamera.attach manquant).' });
        return false;
      }
      try {
        const videoConstraints = deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: facingMode || 'environment' };
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        videoEl.srcObject = stream;
        videoEl.removeAttribute('src');
        await videoEl.play().catch(() => {}); // autoplay peut être bloqué tant que l'utilisateur n'a pas interagi
        status = 'live';
        source = 'device';
        emit('cbcam:start', {});
        return true;
      } catch (err) {
        emit('cbcam:error', { message: friendlyError(err) });
        return false;
      }
    },

    /** Repli « flux réseau » : URL vidéo directe (caméra IP exposant du HLS/MP4, enregistreur...). */
    async connectUrl(url) {
      if (!videoEl) return false;
      if (!url || !/^https?:\/\//i.test(url)) {
        emit('cbcam:error', { message: 'URL de flux invalide (http/https attendu).' });
        return false;
      }
      this.stop();
      videoEl.srcObject = null;
      videoEl.src = url;
      try {
        await videoEl.play();
        status = 'live';
        source = 'network';
        emit('cbcam:start', {});
        return true;
      } catch (err) {
        emit('cbcam:error', { message: "Impossible de lire ce flux vidéo (URL inaccessible ou format non supporté par le navigateur)." });
        return false;
      }
    },

    pause() {
      if (status !== 'live' || !videoEl) return false;
      videoEl.pause();
      status = 'paused';
      emit('cbcam:pause', {});
      return true;
    },

    resume() {
      if (status !== 'paused' || !videoEl) return false;
      videoEl.play().catch(() => {});
      status = 'live';
      emit('cbcam:resume', {});
      return true;
    },

    stop() {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      if (videoEl) {
        videoEl.pause();
        videoEl.srcObject = null;
        videoEl.removeAttribute('src');
      }
      const wasActive = status !== 'idle';
      status = 'idle';
      source = null;
      if (wasActive) emit('cbcam:stop', {});
    },

    /** Capture l'image actuelle du flux vidéo en PNG (data URL), pour la « Capture instantanée ». */
    capture() {
      if (!videoEl || !videoEl.videoWidth) {
        emit('cbcam:error', { message: 'Aucune image vidéo disponible à capturer pour le moment.' });
        return null;
      }
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      emit('cbcam:capture', { dataUrl });
      return dataUrl;
    },
  };

  window.CBMatchCamera = CBMatchCamera;
})();
