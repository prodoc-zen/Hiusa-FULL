const MOCK_ENABLED = import.meta.env.VITE_FINGERPRINT_MOCK === 'true';
const SAMPLE_FORMAT_PNG = 5;

const QUALITY_MESSAGES = {
  0: 'Good quality',
  1: 'No fingerprint detected.',
  2: 'The scan is too light. Press a little more firmly.',
  3: 'The scan is too dark. Clean and dry the reader.',
  4: 'The scan is too noisy. Clean the reader and try again.',
  5: 'Fingerprint contrast is too low.',
  6: 'Not enough fingerprint detail was captured.',
  7: 'Center your finger on the reader.',
  8: 'No finger was recognized on the reader.',
  9: 'Move your finger lower on the reader.',
  10: 'Move your finger higher on the reader.',
  11: 'Move your finger to the right.',
  12: 'Move your finger to the left.',
  14: 'Move your finger more slowly.',
  19: 'You are pressing too hard.',
  20: 'Press a little more firmly.',
  21: 'Dry your finger and the reader, then try again.',
  23: 'Place more of your finger on the reader.',
  24: 'Keep your finger straight on the reader.',
};

class DigitalPersonaService {
  constructor() {
    this.api = null;
    this.initializing = null;
    this.listeners = new Set();
    this.capturePromise = null;
    this.captureHandlers = null;
    this.acquisitionActive = false;
    this.state = { readers: [], connected: false, scanning: false, status: 'idle', quality: null, error: null, mock: MOCK_ENABLED };
    this.handlers = {
      DeviceConnected: () => this.refreshReaders(),
      DeviceDisconnected: () => { this.acquisitionActive = false; this.stopCapture().catch(() => {}); this.refreshReaders(); },
      AcquisitionStarted: () => { this.acquisitionActive = true; this.setState({ scanning: true, status: 'scanning', error: null }); },
      AcquisitionStopped: () => { this.acquisitionActive = false; this.setState({ scanning: false, status: this.state.connected ? 'connected' : 'disconnected' }); },
      QualityReported: (event) => this.setState({ quality: Number(event.quality) }),
      ErrorOccurred: (event) => this.setState({ error: `Reader error (0x${Number(event.error).toString(16)}).`, status: 'error' }),
      CommunicationFailed: () => this.setState({ connected: false, readers: [], scanning: false, status: 'service-unavailable', error: 'DigitalPersona client service is unavailable.' }),
    };
  }

  getSnapshot = () => this.state;
  subscribe = (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async initialize() {
    if (this.initializing) return this.initializing;
    this.setState({ status: 'initializing', error: null });
    this.initializing = (async () => {
      if (MOCK_ENABLED) {
        const readers = [{ id: 'development-mock-reader', modality: 2, technology: 1 }];
        this.setState({ readers, connected: true, status: 'connected' });
        return readers;
      }
      if (!window.Fingerprint?.WebApi) {
        this.setState({ status: 'sdk-unavailable', error: 'DigitalPersona browser SDK did not load.', connected: false });
        return [];
      }
      this.api = new window.Fingerprint.WebApi();
      Object.entries(this.handlers).forEach(([eventName, handler]) => this.api.on(eventName, handler));
      return this.refreshReaders();
    })().catch((error) => {
      this.setState({ connected: false, readers: [], status: 'service-unavailable', error: this.friendlyError(error) });
      return [];
    });
    return this.initializing;
  }

  async refreshReaders() {
    if (MOCK_ENABLED) return this.state.readers;
    if (!this.api) return [];
    try {
      const ids = await this.api.enumerateDevices();
      const readers = await Promise.all(ids.map(async (id) => {
        const info = await this.api.getDeviceInfo(id);
        return { id, modality: info.eDeviceModality, technology: info.eDeviceTech };
      }));
      this.setState({ readers, connected: readers.length > 0, status: readers.length ? 'connected' : 'disconnected', error: readers.length ? null : 'DigitalPersona fingerprint reader not detected.' });
      return readers;
    } catch (error) {
      this.setState({ connected: false, readers: [], status: 'service-unavailable', error: this.friendlyError(error) });
      return [];
    }
  }

  async startCapture() {
    await this.initialize();
    if (this.state.scanning) throw new Error('Scanner is already in use.');
    if (!this.state.connected) throw new Error('DigitalPersona 4500 not detected.');
    if (!MOCK_ENABLED) await this.api.startAcquisition(SAMPLE_FORMAT_PNG, this.state.readers[0]?.id);
    this.acquisitionActive = true;
    this.setState({ scanning: true, status: 'scanning', error: null, quality: null });
  }

  async stopCapture() {
    if (!MOCK_ENABLED && this.api && (this.acquisitionActive || this.state.scanning)) {
      await this.api.stopAcquisition(this.state.readers[0]?.id);
    }
    this.acquisitionActive = false;
    this.setState({ scanning: false, status: this.state.connected ? 'connected' : 'disconnected' });
  }

  async captureSample(timeoutMs = 20000) {
    if (this.capturePromise) throw new Error('Scanner is already in use.');
    this.capturePromise = MOCK_ENABLED ? this.captureMockSample() : this.captureRealSample(timeoutMs);
    try { return await this.capturePromise; } finally { this.capturePromise = null; }
  }

  async captureRealSample(timeoutMs) {
    await this.initialize();
    if (!this.api || !this.state.connected) throw new Error('DigitalPersona 4500 not detected.');
    return new Promise((resolve, reject) => {
      let lastQuality = null;
      let settled = false;
      const cleanup = async () => {
        clearTimeout(timer);
        this.api.off('QualityReported', onQuality);
        this.api.off('SamplesAcquired', onSample);
        this.api.off('DeviceDisconnected', onDisconnected);
        this.api.off('ErrorOccurred', onError);
        this.captureHandlers = null;
        try { await this.stopCapture(); } catch { this.acquisitionActive = false; this.setState({ scanning: false }); }
      };
      const finish = async (error, value) => {
        if (settled) return;
        settled = true;
        await cleanup();
        if (error) reject(error); else resolve(value);
      };
      const onQuality = (event) => { lastQuality = Number(event.quality); this.setState({ quality: lastQuality }); };
      const onSample = (event) => {
        if (lastQuality !== 0) { finish(new Error(QUALITY_MESSAGES[lastQuality] || 'Fingerprint quality is too low.')); return; }
        const samples = this.parseSamples(event.samples);
        if (!samples.length) { finish(new Error('No fingerprint sample was returned by the reader.')); return; }
        finish(null, { samples: samples.slice(0, 1), sampleFormat: SAMPLE_FORMAT_PNG, deviceId: event.deviceUid, quality: lastQuality });
      };
      const onDisconnected = () => finish(new Error('Scanner disconnected during capture.'));
      const onError = (event) => finish(new Error(`Fingerprint capture failed (0x${Number(event.error).toString(16)}).`));
      const timer = setTimeout(() => finish(new Error('Fingerprint capture timed out. Please try again.')), timeoutMs);
      this.captureHandlers = { finish };
      this.api.on('QualityReported', onQuality);
      this.api.on('SamplesAcquired', onSample);
      this.api.on('DeviceDisconnected', onDisconnected);
      this.api.on('ErrorOccurred', onError);
      this.startCapture().catch((error) => finish(new Error(this.friendlyError(error))));
    });
  }

  async captureMockSample() {
    await this.startCapture();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = async (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await this.stopCapture();
        this.captureHandlers = null;
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(async () => {
        await finish(null, { samples: [`development-mock-${crypto.randomUUID()}`], sampleFormat: SAMPLE_FORMAT_PNG, deviceId: 'development-mock-reader', quality: 0 });
      }, 500);
      this.captureHandlers = { finish };
    });
  }

  async enrollFingerprint(sampleCount = 4, onProgress = () => {}) {
    const samples = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const capture = await this.captureSample();
      samples.push(capture.samples[0]);
      onProgress({ captured: index + 1, required: sampleCount });
      if (index < sampleCount - 1) await new Promise((resolve) => setTimeout(resolve, 700));
    }
    return { samples, sampleFormat: SAMPLE_FORMAT_PNG };
  }

  async identifyFingerprint() {
    const capture = await this.captureSample();
    return { samples: [capture.samples[0]], sampleFormat: SAMPLE_FORMAT_PNG };
  }

  cancelCapture() {
    if (this.captureHandlers) this.captureHandlers.finish(new Error('Fingerprint capture cancelled.'));
    else return this.stopCapture();
  }

  parseSamples(encodedSamples) {
    const normalize = (sample) => typeof sample === 'string' ? sample : sample?.Data ?? sample?.data ?? sample?.SampleData ?? sample?.sampleData ?? null;
    if (Array.isArray(encodedSamples)) return encodedSamples.map(normalize).filter(Boolean);
    try { const parsed = JSON.parse(encodedSamples); return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : []; } catch { return []; }
  }

  friendlyError(error) {
    const message = error?.message || String(error);
    if (/communication failure/i.test(message)) return 'DigitalPersona client service is unavailable.';
    if (/startacquisition/i.test(message)) return 'Scanner is busy or could not start acquisition.';
    return message;
  }
}

export const digitalPersonaService = new DigitalPersonaService();
export { QUALITY_MESSAGES, SAMPLE_FORMAT_PNG };
