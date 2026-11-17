import { useEffect, useState } from 'preact/hooks';
import { Transport } from '../ui/Transport';
import { TrackStrip } from '../ui/TrackStrip';
import { BottomNav } from '../ui/BottomNav';
import { Play } from '../screens/Play';
import { Sound } from '../screens/Sound';
import { Perform } from '../screens/Perform';
import { FxSheet } from '../screens/FxSheet';
import { fxSheetOpen, screen } from './nav';
import { ResetToast } from '../ui/ProjectSheet';
import { useFxKeys, usePreventZoom, useShortcuts } from './shortcuts';
import { DesktopApp } from './DesktopApp';

/** Desktop shell from this viewport width up; the phone shell below it. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

function useIsDesktop(): boolean {
  const [on, setOn] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const f = () => setOn(mq.matches);
    mq.addEventListener('change', f);
    f();
    return () => mq.removeEventListener('change', f);
  }, []);
  return on;
}

function PhoneApp() {
  return (
    <div class="app noselect">
      <div class="app-top">
        <Transport />
        <TrackStrip />
      </div>
      <main class="app-main">
        {screen.value === 'sound' ? <Sound /> : screen.value === 'perform' ? <Perform /> : <Play />}
      </main>
      <ResetToast />
      <BottomNav />
      {fxSheetOpen.value && <FxSheet />}
    </div>
  );
}

export function App() {
  useShortcuts();
  usePreventZoom();
  useFxKeys();
  return useIsDesktop() ? <DesktopApp /> : <PhoneApp />;
}
