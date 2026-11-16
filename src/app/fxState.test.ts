import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../engine/host', () => ({ fxPress: vi.fn(async () => {}), fxXY: vi.fn() }));

import { fxPress, fxXY } from '../engine/host';
import { selectedTrack } from '../store/project';
import { FX_DEFAULT_XY } from '../engine/fx/ids';
import { fxTarget, heldFx, latch, moveXY, onFxEvent, pressFx, releaseAllFx, releaseFx, setLatch, type FxEvent } from './fxState';

beforeEach(() => {
  releaseAllFx();
  latch.value = false;
  fxTarget.value = 'master';
  selectedTrack.value = 0;
  vi.clearAllMocks();
});

describe('fxState', () => {
  it('press and release hit the engine on the master', () => {
    pressFx('stutter4');
    expect(fxPress).toHaveBeenLastCalledWith('stutter4', true, -1, ...FX_DEFAULT_XY.stutter4);
    expect(heldFx.value).toEqual(['stutter4']);
    releaseFx('stutter4');
    expect(fxPress).toHaveBeenLastCalledWith('stutter4', false, -1);
    expect(heldFx.value).toEqual([]);
  });

  it('latch: press toggles and release does nothing', () => {
    setLatch(true);
    pressFx('lofi');
    releaseFx('lofi');
    expect(heldFx.value).toEqual(['lofi']);
    pressFx('lofi');
    expect(heldFx.value).toEqual([]);
    pressFx('gate');
    setLatch(false);
    expect(heldFx.value).toEqual([]);
  });

  it('moveXY applies to every held effect and clamps', () => {
    pressFx('lowSweep');
    pressFx('lofi');
    moveXY(1.5, -1);
    expect(fxXY).toHaveBeenCalledWith('lowSweep', 1, 0);
    expect(fxXY).toHaveBeenCalledWith('lofi', 1, 0);
    releaseFx('lowSweep');
    moveXY(0.2, 0.3);
    expect(fxXY).toHaveBeenLastCalledWith('lofi', 0.2, 0.3);
    expect(fxXY).toHaveBeenCalledTimes(3);
  });

  it('target resolution: track mode uses the selected track', () => {
    fxTarget.value = 'track';
    selectedTrack.value = 3;
    pressFx('gate');
    expect(fxPress).toHaveBeenLastCalledWith('gate', true, 3, ...FX_DEFAULT_XY.gate);
  });

  it('a track-targeted effect is released when the selected track changes; master ones stay', () => {
    selectedTrack.value = 3;
    fxTarget.value = 'track';
    pressFx('gate');
    fxTarget.value = 'master';
    pressFx('lofi');
    selectedTrack.value = 4;
    expect(fxPress).toHaveBeenCalledWith('gate', false, 3);
    expect(heldFx.value).toEqual(['lofi']);
  });

  it('emits press, move and release events', () => {
    const events: FxEvent[] = [];
    const off = onFxEvent((e) => events.push(e));
    pressFx('reverse');
    moveXY(0.4, 0.6);
    releaseFx('reverse');
    off();
    pressFx('reverse');
    expect(events.map((e) => [e.fx, e.on, e.x, e.y])).toEqual([
      ['reverse', true, ...FX_DEFAULT_XY.reverse],
      ['reverse', true, 0.4, 0.6],
      ['reverse', false, 0.4, 0.6],
    ]);
  });
});
