// P2-5B fixed processing profile (T-130 5장, T-134). Every number the mix, the ducking and the loudness steps use is
// here; nothing is taken from the caller as filter text. The profile id is the same as the timeline v2 audioMixProfile.
// Targets are the experiment defaults Master set for P2-5B (-14 LUFS, TP -2, LRA 7, AAC-LC stereo 192k); the final
// AAC acceptance check (I within ±1 LU, true peak ≤ -1 dBTP) is measured on the file, never assumed from the settings.
export const PROFILE_ID="p2-5-local-v1" as const;
export const SAMPLE_RATE=48000;
export const FPS=30;
export const SAMPLES_PER_FRAME=SAMPLE_RATE/FPS;// 1600
export const CHANNELS=2;
export const LOUDNESS={integrated:-14,truePeak:-2,range:7} as const;
export const ACCEPT={integratedTolerance:1,truePeakMax:-1} as const;
export const AAC={codec:"aac",profile:"aac_low",bitrate:"192k"} as const;
// Ducking: the voice bus (its real signal, not words or subtitles) drives a compressor on ducked music only.
// threshold 0.03 ≈ -30 dBFS (rms detection), ratio 6:1, attack 20 ms, release 300 ms, no makeup gain.
export const DUCK={threshold:0.03,ratio:6,attack:20,release:300,makeup:1,link:"maximum",detection:"rms"} as const;
// Plain clip fades are linear ("tri"); a join between two songs uses equal power: quarter-sine in/out ("qsin"), so
// gain_out² + gain_in² = 1 across the overlap.
export const FADE_CURVE="tri",JOIN_CURVE="qsin";
// Loudness is measured only on a mix of at least 3 s (EBU R128 loudness range uses 3 s windows); a shorter mix is
// reported as too short and is not normalized.
export const MIN_NORMALIZE_FRAMES=3*FPS;
// loudnorm accepts a measured integrated loudness only up to 0 LUFS. A mix measured above -1 LUFS is first scaled by
// a fixed f32 gain to the target (exact multiply, no clipping in f32), measured again, and that scaled PCM is the one
// the second pass reads. The gain is recorded.
export const PREGAIN_ABOVE_LUFS=-1;
// Module bound: 10 minutes of output (the f32 stereo mix is then 230 MB in the owned work folder).
export const MAX_OUTPUT_FRAMES=10*60*FPS;
export const MAX_CLIPS=100;
export const DEFAULT_TIMEOUT_MS=10*60*1000;
