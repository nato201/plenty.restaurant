/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

class SoundAlertManager {
  private audioCtx: AudioContext | null = null;
  private intervalId: any = null;
  private isAlerting = false;
  private isEnabled = true;
  private volume = 0.8;

  constructor() {
    if (typeof window !== 'undefined') {
      const storedEnabled = localStorage.getItem('plenty_sound_enabled');
      if (storedEnabled !== null) {
        this.isEnabled = storedEnabled === 'true';
      }
      const storedVol = localStorage.getItem('plenty_sound_volume');
      if (storedVol !== null) {
        this.volume = Math.max(0, Math.min(1, parseFloat(storedVol) || 0.8));
      }
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public getSettings() {
    return {
      enabled: this.isEnabled,
      volume: this.volume,
      isAlerting: this.isAlerting,
    };
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('plenty_sound_enabled', String(enabled));
    }
    if (!enabled && this.isAlerting) {
      this.stopContinuousAlert();
    }
  }

  public setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (typeof window !== 'undefined') {
      localStorage.setItem('plenty_sound_volume', String(this.volume));
    }
  }

  /**
   * Plays a single two-tone chime (A5 -> D6) using the Web Audio API synthesizer
   */
  public playChime() {
    if (!this.isEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.001, now);
      // Fade in and out
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, this.volume * 0.45), now + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      gainNode.connect(ctx.destination);

      // Note 1 (880 Hz - A5)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(920, now + 0.3);
      osc1.connect(gainNode);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Note 2 (1174.66 Hz - D6) - brighter notification chime
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1174.66, now + 0.25);
      osc2.connect(gainNode);
      osc2.start(now + 0.25);
      osc2.stop(now + 1.2);

      // Subtle harmonic overtone for warmth
      const osc3 = ctx.createOscillator();
      const harmonicGain = ctx.createGain();
      harmonicGain.gain.setValueAtTime(this.volume * 0.1, now);
      harmonicGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(1760, now + 0.25);
      osc3.connect(harmonicGain);
      harmonicGain.connect(ctx.destination);
      osc3.start(now + 0.25);
      osc3.stop(now + 0.8);
    } catch (e) {
      console.warn('Audio playback not permitted yet or failed:', e);
    }
  }

  /**
   * Starts repeating continuous alert loop every 3 seconds until stopped
   */
  public startContinuousAlert() {
    if (this.isAlerting) return;
    this.isAlerting = true;
    this.playChime();

    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      if (this.isAlerting && this.isEnabled) {
        this.playChime();
      }
    }, 3200);
  }

  /**
   * Stops continuous audio alert loop
   */
  public stopContinuousAlert() {
    this.isAlerting = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Test tone
   */
  public testSound() {
    const wasEnabled = this.isEnabled;
    this.isEnabled = true;
    this.playChime();
    this.isEnabled = wasEnabled;
  }
}

export const soundAlert = new SoundAlertManager();
