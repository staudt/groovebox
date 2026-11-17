# Asset licenses

All bundled audio is released under **CC0-1.0** (public domain dedication). No attribution is required; credit is given here anyway.

- Virtuosity Drums by Versilian Studios: https://github.com/sfzinstruments/virtuosity_drums (commit `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc`)
- Phazite Sounds by august-byrne: https://github.com/august-byrne/phazite-sounds (commit `bd71faf5035e8aa278ebfe3f4dc68804ae7bc5ca`), used only for the clap.

The kit (`public/kits/virtuosity/kit.mp3` + `kit.json`) was built by the beatboy project (same author) with its `scripts/build-kit.mjs`; copied here unchanged.

## Processing (all sounds)

1. Stereo mixed down to mono; when two mics are listed they are summed with the weights shown (same take, time-aligned).
2. Leading silence trimmed (threshold -50 dB, 1 ms kept before the transient).
3. Truncated to the length shown, with a quarter-sine exponential-style fade (`qsin`) over the last 35% of that length.
4. Peak-normalized to -1 dBFS, 44.1 kHz mono 16-bit.
5. Concatenated with 0.08 s of silence before each sound and encoded as a single mono MP3 (libmp3lame, 112 kbps CBR).

## Sounds

- **kick**: [`Samples/kickmic/kick/kickmic_kick_snoff_vl3_rr1.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/kickmic/kick/kickmic_kick_snoff_vl3_rr1.flac) x0.7 + [`Samples/oh/kick/oh_kick_snoff_vl3_rr1.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/kick/oh_kick_snoff_vl3_rr1.flac) x0.3; length 0.75 s.
- **snare**: [`Samples/snaremic/snare/snaremic_snare_center_vl27.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/snaremic/snare/snaremic_snare_center_vl27.flac) x0.6 + [`Samples/oh/snare/oh_snare_center_vl27.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/snare/oh_snare_center_vl27.flac) x0.4; length 0.75 s.
- **sidestick**: [`Samples/snaremic/snare/snaremic_snare_crossstick_vl12.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/snaremic/snare/snaremic_snare_crossstick_vl12.flac) x0.5 + [`Samples/oh/snare/oh_snare_crossstick_vl12.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/snare/oh_snare_crossstick_vl12.flac) x0.5; length 0.6 s.
- **clap**: [`pack/Drums/Claps/Clap Studio.flac`](https://github.com/august-byrne/phazite-sounds/blob/bd71faf5035e8aa278ebfe3f4dc68804ae7bc5ca/pack/Drums/Claps/Clap%20Studio.flac); length 0.6 s.
- **hatClosed**: [`Samples/oh/hh/oh_hh_closed_vl3_rr1.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/hh/oh_hh_closed_vl3_rr1.flac); length 0.4 s.
- **hatPedal**: [`Samples/oh/hh/oh_hh_pedal_vl2_rr1.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/hh/oh_hh_pedal_vl2_rr1.flac); length 0.4 s.
- **hatOpen**: [`Samples/oh/hh/oh_hh_open_vl3_rr1.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/hh/oh_hh_open_vl3_rr1.flac); length 1 s.
- **ride**: [`Samples/oh/ride/oh_ride_ride_vl2_rr1.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/ride/oh_ride_ride_vl2_rr1.flac); length 1.8 s.
- **rideBell**: [`Samples/oh/ride/oh_ride_bell_vl2_rr1.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/ride/oh_ride_bell_vl2_rr1.flac); length 1.8 s.
- **crash**: [`Samples/oh/crash/oh_crash_crash_vl2_rr1.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/crash/oh_crash_crash_vl2_rr1.flac); length 2.2 s.
- **crash2**: [`Samples/oh/flatride/oh_flatride_crash_vl3.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/flatride/oh_flatride_crash_vl3.flac); length 2.2 s.
- **tomHigh**: [`Samples/oh/htom/oh_htom_center_vl12.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/htom/oh_htom_center_vl12.flac) x0.7 + [`Samples/mid/htom/mid_htom_center_vl12.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/mid/htom/mid_htom_center_vl12.flac) x0.3; length 1.1 s.
- **tomMid**: [`Samples/oh/htom/oh_htom_center_vl12.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/htom/oh_htom_center_vl12.flac) x0.7 + [`Samples/mid/htom/mid_htom_center_vl12.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/mid/htom/mid_htom_center_vl12.flac) x0.3; length 1.2 s; pitched -3 semitones by resampling.
- **tomFloor**: [`Samples/oh/ltom/oh_ltom_center_vl12.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/oh/ltom/oh_ltom_center_vl12.flac) x0.7 + [`Samples/mid/ltom/mid_ltom_center_vl12.flac`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/mid/ltom/mid_ltom_center_vl12.flac) x0.3; length 1.2 s.
- **tambourine**: [`Samples/perc/oh/tambourine/Tamb1_Shake_rr1_Overhead.wav`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/perc/oh/tambourine/Tamb1_Shake_rr1_Overhead.wav); length 0.6 s.
- **cowbell**: [`Samples/perc/oh/cowbell/Cowbell1_Normal_v2_rr1_Overhead.wav`](https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/Samples/perc/oh/cowbell/Cowbell1_Normal_v2_rr1_Overhead.wav); length 0.6 s.

### Notes

- `tomMid` is the high-tom sample pitched down 3 semitones (the library has no mid tom); `tomFloor` uses the low tom (`ltom`) center, since the library has no floor tom.
- `crash2` is the flat-ride crash articulation.

### Clap provenance (from Phazite Sounds `pack/sources.json`)

- Versilian Community Sample Library (VCSL): Idiophones/Struck Idiophones/Claps/Clap_rr1.wav by Versilian Studios and contributors, CC0-1.0: https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Claps/Clap_rr1.wav
- Upstream processing in Phazite: trimmed from its first sound to -60 dB, faded out over 10 ms, peak-normalized to -1 dBFS, and written as 44.1 kHz 16-bit FLAC with triangular dither by phazite_soundkit
