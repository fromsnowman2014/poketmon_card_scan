import { useRef, useState, type ChangeEvent } from 'react';
import { cx } from '../../components/cx';
import { Icon, type IconName } from '../../components/Icon';
import { useStrings, type Strings } from '../../lib/i18n';
import { cropToCard } from '../../lib/imageProc';
import { GuideFrame } from './GuideFrame';
import { useCamera } from './useCamera';

type Key =
  | 'title'
  | 'close'
  | 'torchOn'
  | 'torchOff'
  | 'shutter'
  | 'photos'
  | 'type'
  | 'cameraApp'
  | 'starting'
  | 'tipLight'
  | 'tipShine'
  | 'tipFill'
  | 'deniedTitle'
  | 'unavailableTitle'
  | 'fallbackText'
  | 'deniedHelp'
  | 'retry';

const STRINGS: Strings<Key> = {
  ko: {
    title: '카드를 네모 안에 맞춰요',
    close: '닫기',
    torchOn: '플래시 켜기',
    torchOff: '플래시 끄기',
    shutter: '찍기',
    photos: '사진에서 고르기',
    type: '직접 입력',
    cameraApp: '카메라 앱으로 찍기',
    starting: '카메라 켜는 중…',
    tipLight: '밝은 곳에서',
    tipShine: '반짝임 피하기',
    tipFill: '네모 꽉 채우기',
    deniedTitle: '카메라가 꺼져 있어요',
    unavailableTitle: '카메라를 쓸 수 없어요',
    fallbackText: '사진을 고르거나 직접 입력해요.',
    deniedHelp: '어른이 설정 › Safari › 카메라에서 허용할 수 있어요',
    retry: '카메라 다시 켜기',
  },
  en: {
    title: 'Fit the card in the box',
    close: 'Close',
    torchOn: 'Turn on the light',
    torchOff: 'Turn off the light',
    shutter: 'Take photo',
    photos: 'Photos',
    type: 'Type',
    cameraApp: 'Use Camera app',
    starting: 'Starting the camera…',
    tipLight: 'Bright light',
    tipShine: 'No shine',
    tipFill: 'Fill the box',
    deniedTitle: 'Camera is off',
    unavailableTitle: "Can't use the camera",
    fallbackText: 'Use a photo or type instead.',
    deniedHelp: 'A grown-up can allow it in Settings › Safari › Camera',
    retry: 'Try the camera again',
  },
};

const TIPS_KEY = 'cc:scanTipsSeen';

function tipsSeen(): boolean {
  try {
    return localStorage.getItem(TIPS_KEY) === '1';
  } catch {
    return false;
  }
}

function markTipsSeen(): void {
  try {
    localStorage.setItem(TIPS_KEY, '1');
  } catch {
    // storage blocked: the tips just show again next time
  }
}

export interface CameraViewProps {
  onCapture: (card: HTMLCanvasElement) => void;
  onPhoto: (file: File) => void;
  /** Leave the scan screen (to `path`, or back). The camera is already stopped when this runs. */
  onLeave: (path?: string) => void;
}

/** Live viewfinder with the card guide, shutter, photo pickers and camera fallbacks. */
export function CameraView({ onCapture, onPhoto, onLeave }: CameraViewProps) {
  const t = useStrings(STRINGS);
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const cameraApp = useRef<HTMLInputElement>(null);
  const camera = useCamera(video);
  const [showTips] = useState(() => !tipsSeen());
  const failed = camera.status === 'denied' || camera.status === 'unavailable';

  const leave = (path?: string) => {
    camera.stop(); // before the route changes: iOS may re-ask for the camera otherwise
    onLeave(path);
  };

  const capture = () => {
    const v = video.current;
    const f = frame.current;
    if (!v || !f || !v.videoWidth) return;
    markTipsSeen();
    onCapture(cropToCard(v, f.getBoundingClientRect(), v.getBoundingClientRect()));
  };

  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same photo again should still fire
    if (!file) return;
    markTipsSeen();
    onPhoto(file);
  };

  const sideButton = (icon: IconName, label: string, onClick: () => void) => (
    <button type="button" className="scan-side" onClick={onClick}>
      <span className="scan-round scan-round-lg">
        <Icon name={icon} size={26} />
      </span>
      <span className="scan-side-label">{label}</span>
    </button>
  );

  return (
    <div className="scan-stage">
      <video ref={video} className="scan-media scan-video" playsInline muted autoPlay aria-hidden="true" />

      <div className="scan-ui">
        <header className="scan-top">
          <button type="button" className="scan-round" onClick={() => leave()} aria-label={t('close')}>
            <Icon name="x" size={24} />
          </button>
          <h1 className={cx('scan-title', failed && 'sr-only')}>{t('title')}</h1>
          {camera.torch === null ? (
            <span className="scan-top-spacer" />
          ) : (
            <button
              type="button"
              className={cx('scan-round', camera.torch && 'scan-round-on')}
              onClick={camera.toggleTorch}
              aria-pressed={camera.torch}
              aria-label={camera.torch ? t('torchOff') : t('torchOn')}
            >
              <Icon name="flashlight" size={22} />
            </button>
          )}
        </header>

        {failed ? (
          <div className="scan-frame-area">
            <section className="scan-fallback pop-in" role="alert">
              <span className="scan-fallback-icon" aria-hidden="true">
                <Icon name="camera" size={34} />
              </span>
              <h2 className="h2">{camera.status === 'denied' ? t('deniedTitle') : t('unavailableTitle')}</h2>
              <p className="scan-fallback-text">{t('fallbackText')}</p>
              <div className="scan-fallback-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-lg btn-block"
                  onClick={() => photos.current?.click()}
                >
                  <Icon name="image" />
                  {t('photos')}
                </button>
                <button
                  type="button"
                  className="btn scan-glass-btn btn-lg btn-block"
                  onClick={() => cameraApp.current?.click()}
                >
                  <Icon name="camera" />
                  {t('cameraApp')}
                </button>
                <button type="button" className="btn scan-glass-btn btn-lg btn-block" onClick={() => leave('/search')}>
                  <Icon name="keyboard" />
                  {t('type')}
                </button>
              </div>
              {camera.status === 'denied' && <p className="scan-fallback-help">{t('deniedHelp')}</p>}
              <button type="button" className="scan-text-btn" onClick={camera.retry}>
                <Icon name="refresh" size={18} />
                {t('retry')}
              </button>
            </section>
          </div>
        ) : (
          <GuideFrame ref={frame}>
            {camera.status === 'starting' && (
              <span className="scan-starting" role="status">
                <span className="spinner" aria-hidden="true" />
                {t('starting')}
              </span>
            )}
          </GuideFrame>
        )}

        {!failed && (
          <div className="scan-bottom">
            {showTips && (
              <ul className="scan-tips fade-in">
                <li>
                  <Icon name="sun" size={16} />
                  {t('tipLight')}
                </li>
                <li>
                  <Icon name="sparkles" size={16} />
                  {t('tipShine')}
                </li>
                <li>
                  <Icon name="cards" size={16} />
                  {t('tipFill')}
                </li>
              </ul>
            )}
            <div className="scan-controls">
              {sideButton('image', t('photos'), () => photos.current?.click())}
              <button
                type="button"
                className="scan-shutter"
                onClick={capture}
                disabled={camera.status !== 'live'}
                aria-label={t('shutter')}
              >
                <span className="scan-shutter-core" />
              </button>
              {sideButton('keyboard', t('type'), () => leave('/search'))}
            </div>
            <button type="button" className="scan-pill" onClick={() => cameraApp.current?.click()}>
              <Icon name="camera" size={18} />
              {t('cameraApp')}
            </button>
          </div>
        )}
      </div>

      <input ref={photos} type="file" accept="image/*" hidden onChange={picked} />
      <input ref={cameraApp} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
    </div>
  );
}
