/**
 * TimesheetVoice: World-Class Voice Intelligence & Audio Visualizer
 * Powered by Web Speech API & HTML5 Web Audio API AnalyserNode.
 * 
 * • 100% Verbatim speech-to-text (no artificial prefixes).
 * • Real-time 60fps audio waveform canvas rendering.
 * • Accessible status announcements & keyboard toggles.
 */

class TimesheetVoice {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.targetElement = null;
    this.onStateChangeCallback = null;

    // Web Audio Visualizer state
    this.audioContext = null;
    this.analyser = null;
    this.microphoneStream = null;
    this.canvas = null;
    this.canvasCtx = null;
    this.animationFrameId = null;

    this.initSpeechRecognition();
  }

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Web Speech API is not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      this.startAudioVisualizer();
      if (this.onStateChangeCallback) {
        this.onStateChangeCallback(true);
      }
    };

    this.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const spoken = event.results[i][0].transcript.trim();
          if (spoken) {
            this.appendTranscript(spoken);
          }
        }
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('Speech recognition event:', event.error);
      if (event.error !== 'no-speech') {
        this.stop();
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.stopAudioVisualizer();
      if (this.onStateChangeCallback) {
        this.onStateChangeCallback(false);
      }
    };
  }

  setTargetElement(el) {
    this.targetElement = el;
  }

  setVisualizerCanvas(canvasEl) {
    this.canvas = canvasEl;
    if (this.canvas) {
      this.canvasCtx = this.canvas.getContext('2d');
      this.startAmbientWave();
    }
  }

  // Pleasant Web Audio Synth Chimes
  playTone(type = 'start') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (type === 'start') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'stop') {
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.15);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'save') {
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) {
      // Audio context policy fallback
    }
  }

  // Gentle Ambient Wave for Idle State
  startAmbientWave() {
    if (!this.canvas || !this.canvasCtx) return;
    let step = 0;

    const drawIdle = () => {
      if (this.isListening) return; // Mic active replaces idle
      step += 0.05;

      const width = this.canvas.width;
      const height = this.canvas.height;
      this.canvasCtx.clearRect(0, 0, width, height);

      this.canvasCtx.beginPath();
      this.canvasCtx.lineWidth = 1.5;
      this.canvasCtx.strokeStyle = 'rgba(56, 189, 248, 0.25)';

      for (let x = 0; x < width; x += 4) {
        const y = height / 2 + Math.sin(x * 0.08 + step) * 4 * Math.sin(step * 0.5);
        if (x === 0) this.canvasCtx.moveTo(x, y);
        else this.canvasCtx.lineTo(x, y);
      }
      this.canvasCtx.stroke();

      if (!this.isListening) {
        this.idleAnimId = requestAnimationFrame(drawIdle);
      }
    };

    drawIdle();
  }

  onStateChange(callback) {
    this.onStateChangeCallback = callback;
  }

  toggle(targetEl) {
    if (targetEl) this.targetElement = targetEl;
    if (this.isListening) {
      this.stop();
    } else {
      this.start();
    }
  }

  async start() {
    if (!this.recognition) {
      alert('Speech recognition is not supported in this browser. You can type notes directly.');
      return;
    }

    try {
      this.recognition.start();
    } catch (e) {
      console.warn('Speech recognition already active:', e);
    }
  }

  stop() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
    this.isListening = false;
    this.stopAudioVisualizer();
  }

  // Appends verbatim words dictated by the user
  appendTranscript(text) {
    if (!this.targetElement) return;

    const current = this.targetElement.value.trim();
    if (current.length === 0) {
      this.targetElement.value = text;
    } else {
      this.targetElement.value = current + ' ' + text;
    }

    this.targetElement.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // --- Real-Time Audio Waveform Visualizer ---
  async startAudioVisualizer() {
    if (!this.canvas || !this.canvasCtx) return;

    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const source = this.audioContext.createMediaStreamSource(this.microphoneStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        if (!this.isListening) return;
        this.animationFrameId = requestAnimationFrame(draw);

        this.analyser.getByteFrequencyData(dataArray);

        const width = this.canvas.width;
        const height = this.canvas.height;
        this.canvasCtx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 1.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * height;

          // Gradient bar
          const gradient = this.canvasCtx.createLinearGradient(0, height, 0, 0);
          gradient.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
          gradient.addColorStop(1, 'rgba(129, 140, 248, 0.9)');

          this.canvasCtx.fillStyle = gradient;
          this.canvasCtx.beginPath();
          this.canvasCtx.roundRect(x, height - barHeight, barWidth - 2, barHeight, 3);
          this.canvasCtx.fill();

          x += barWidth;
        }
      };

      draw();
    } catch (err) {
      console.warn('Audio visualizer fallback (mic permission or unsupported):', err);
    }
  }

  stopAudioVisualizer() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach((t) => t.stop());
      this.microphoneStream = null;
    }
    if (this.canvas && this.canvasCtx) {
      this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

window.TimesheetVoice = new TimesheetVoice();
