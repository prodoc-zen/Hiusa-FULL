import { afterEach, describe, expect, it } from 'vitest';
import { DigitalPersonaService } from './digitalPersonaService';

const originalFingerprint = window.Fingerprint;

class FakeWebApi {
  constructor() {
    this.handlers = {};
  }

  on(eventName, handler) {
    this.handlers[eventName] = [...(this.handlers[eventName] || []), handler];
  }

  off(eventName, handler) {
    this.handlers[eventName] = (this.handlers[eventName] || []).filter((candidate) => candidate !== handler);
  }

  emit(eventName, event) {
    (this.handlers[eventName] || []).forEach((handler) => handler(event));
  }

  async enumerateDevices() {
    return ['reader-1'];
  }

  async getDeviceInfo() {
    return { eDeviceModality: 2, eDeviceTech: 1 };
  }

  async startAcquisition() {
    queueMicrotask(() => this.emit('SamplesAcquired', {
      deviceUid: 'reader-1',
      samples: JSON.stringify(['base64url-png-sample']),
    }));
  }

  async stopAcquisition() {}
}

afterEach(() => {
  window.Fingerprint = originalFingerprint;
});

describe('DigitalPersonaService', () => {
  it('accepts a sample when the SDK emits it before a separate quality event', async () => {
    window.Fingerprint = { WebApi: FakeWebApi };
    const service = new DigitalPersonaService();

    await expect(service.captureSample()).resolves.toMatchObject({
      samples: ['base64url-png-sample'],
      sampleFormat: 5,
      deviceId: 'reader-1',
    });
  });

  it('can initialize after retry when the SDK was unavailable on first load', async () => {
    delete window.Fingerprint;
    const service = new DigitalPersonaService();
    await service.initialize();
    expect(service.getSnapshot().status).toBe('sdk-unavailable');

    window.Fingerprint = { WebApi: FakeWebApi };
    await service.retry();

    expect(service.getSnapshot()).toMatchObject({ connected: true, status: 'connected' });
  });
});
