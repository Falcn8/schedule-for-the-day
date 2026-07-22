import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const colors = {
  paper: '#f7f7f4',
  panel: '#fbfbf8',
  ink: '#171717',
  muted: '#6b6f76',
  line: '#c9cbd0',
  faint: '#ececea',
  red: '#f04438',
};

const font = 'IBM Plex Sans, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'};

const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

const Scene = ({children, style}) => <AbsoluteFill style={style}>{children}</AbsoluteFill>;

const Wordmark = ({light = false, size = 30}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: size * 0.38}}>
    <span
      style={{
        width: size * 0.43,
        height: size * 0.43,
        borderRadius: 999,
        background: colors.red,
        boxShadow: `0 0 0 ${size * 0.12}px rgba(240,68,56,0.12)`,
      }}
    />
    <span
      style={{
        color: light ? colors.paper : colors.ink,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: '-0.035em',
      }}
    >
      Schedule for the Day
    </span>
  </div>
);

const Background = ({dark = false}) => (
  <AbsoluteFill
    style={{
      background: dark ? colors.ink : colors.paper,
      overflow: 'hidden',
    }}
  >
    <AbsoluteFill
      style={{
        opacity: dark ? 0.045 : 0.026,
        backgroundImage:
          'linear-gradient(rgba(107,111,118,.55) 1px, transparent 1px), linear-gradient(90deg, rgba(107,111,118,.55) 1px, transparent 1px)',
        backgroundSize: '72px 72px',
      }}
    />
  </AbsoluteFill>
);

const BrowserFrame = ({src, width = 1400, x = 0, y = 0, scale = 1, shadow = true}) => (
  <div
    style={{
      width,
      aspectRatio: '16 / 10',
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      transformOrigin: 'center',
      border: '1px solid rgba(23,23,23,0.18)',
      borderRadius: 20,
      overflow: 'hidden',
      background: colors.panel,
      boxShadow: shadow ? '0 42px 120px rgba(23,23,23,0.18), 0 10px 30px rgba(23,23,23,0.08)' : 'none',
    }}
  >
    <div
      style={{
        height: 42,
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        gap: 9,
        borderBottom: '1px solid rgba(23,23,23,0.12)',
        background: '#efefeb',
      }}
    >
      {[colors.red, '#d8d9d4', '#c8cac4'].map((color, index) => (
        <span key={color + index} style={{width: 10, height: 10, borderRadius: 99, background: color}} />
      ))}
      <div
        style={{
          marginLeft: 16,
          height: 22,
          width: '62%',
          borderRadius: 99,
          background: 'rgba(255,255,255,0.7)',
          color: colors.muted,
          fontSize: 12,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          letterSpacing: '0.02em',
        }}
      >
        today
      </div>
    </div>
    <Img src={staticFile(src)} style={{display: 'block', width: '100%', height: 'calc(100% - 42px)', objectFit: 'cover'}} />
  </div>
);

const Label = ({children, tone = 'dark', style}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      padding: '11px 16px',
      borderRadius: 999,
      border: `1px solid ${tone === 'light' ? 'rgba(247,247,244,.28)' : 'rgba(23,23,23,.15)'}`,
      background: tone === 'light' ? 'rgba(247,247,244,.08)' : 'rgba(251,251,248,.9)',
      color: tone === 'light' ? colors.paper : colors.ink,
      fontSize: 18,
      fontWeight: 600,
      letterSpacing: '-0.015em',
      ...style,
    }}
  >
    {children}
  </div>
);

const Dot = () => <span style={{width: 8, height: 8, borderRadius: 99, background: colors.red}} />;

const Cursor = ({x, y, click = 0}) => (
  <div style={{position: 'absolute', left: x, top: y, transform: 'translate(-2px, -2px)'}}>
    {click > 0 && (
      <span
        style={{
          position: 'absolute',
          left: -19,
          top: -19,
          width: 46,
          height: 46,
          borderRadius: 99,
          border: `2px solid rgba(240,68,56,${0.75 * (1 - click)})`,
          transform: `scale(${0.55 + click * 1.2})`,
        }}
      />
    )}
    <svg width="35" height="44" viewBox="0 0 35 44" fill="none">
      <path d="M3 2L31 25.1L17.4 27.3L10.1 40.5L3 2Z" fill="#171717" stroke="#F7F7F4" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  </div>
);

const Opening = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const rise = spring({frame, fps, config: {damping: 18, stiffness: 90}});
  const second = spring({frame: frame - 16, fps, config: {damping: 20, stiffness: 80}});
  const lineWidth = interpolate(frame, [28, 78], [0, 520], {...clamp, easing: easeOut});

  return (
    <Scene>
      <Background />
      <div style={{position: 'absolute', left: 112, top: 88}}>
        <Wordmark size={28} />
      </div>
      <div style={{position: 'absolute', left: 112, top: 304, width: 1200}}>
        <div
          style={{
            transform: `translateY(${interpolate(rise, [0, 1], [52, 0])}px)`,
            opacity: rise,
            color: colors.ink,
            fontSize: 112,
            lineHeight: 0.94,
            fontWeight: 700,
            letterSpacing: '-0.065em',
          }}
        >
          Your day,
          <br />
          without the noise.
        </div>
        <div style={{width: lineWidth, height: 6, borderRadius: 99, background: colors.red, marginTop: 42}} />
        <p
          style={{
            margin: '30px 0 0',
            transform: `translateY(${interpolate(second, [0, 1], [28, 0])}px)`,
            opacity: second,
            color: colors.muted,
            fontSize: 31,
            lineHeight: 1.35,
            letterSpacing: '-0.025em',
          }}
        >
          Turn calendar clutter into one calm, workable plan.
        </p>
      </div>
      <div
        style={{
          position: 'absolute',
          right: -285,
          bottom: -310,
          width: 760,
          height: 760,
          borderRadius: 999,
          border: '1px solid rgba(23,23,23,.08)',
          boxShadow: 'inset 0 0 0 68px rgba(23,23,23,.018), inset 0 0 0 136px rgba(23,23,23,.014)',
        }}
      />
    </Scene>
  );
};

const FocusView = () => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 34], [70, 0], {...clamp, easing: easeOut});
  const zoom = interpolate(frame, [20, 210], [1.01, 1.075], {...clamp, easing: Easing.inOut(Easing.ease)});
  const textIn = spring({frame: frame - 22, fps: 30, config: {damping: 18, stiffness: 90}});
  const pulse = (Math.sin(frame / 8) + 1) / 2;

  return (
    <Scene>
      <Background dark />
      <div style={{position: 'absolute', left: 88, top: 68, opacity: 0.8}}>
        <Wordmark light size={24} />
      </div>
      <div style={{position: 'absolute', left: 78, top: 148, transform: `translateY(${enter}px)`}}>
        <BrowserFrame src="view-mode.jpg" width={1500} x={450} y={70} scale={zoom} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 450,
          top: 0,
          bottom: 0,
          width: 360,
          background: 'linear-gradient(90deg, #171717 0%, rgba(23,23,23,.72) 38%, transparent 100%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 112,
          top: 260,
          width: 580,
          opacity: textIn,
          transform: `translateY(${interpolate(textIn, [0, 1], [34, 0])}px)`,
        }}
      >
        <div style={{color: colors.red, fontSize: 21, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase'}}>
          Stay oriented
        </div>
        <h2 style={{margin: '20px 0 22px', color: colors.paper, fontSize: 76, lineHeight: 0.99, letterSpacing: '-0.055em'}}>
          See what matters now.
        </h2>
        <p style={{margin: 0, width: 470, color: '#aeb0b3', fontSize: 27, lineHeight: 1.4, letterSpacing: '-0.02em'}}>
          Current focus, what comes next, and the whole day at a glance.
        </p>
        <div style={{display: 'flex', gap: 12, marginTop: 34}}>
          <Label tone="light"><Dot /> Now</Label>
          <Label tone="light">Next</Label>
          <Label tone="light">Remaining</Label>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 294,
          top: 371,
          width: 17 + pulse * 5,
          height: 17 + pulse * 5,
          borderRadius: 99,
          background: colors.red,
          boxShadow: `0 0 0 ${10 + pulse * 9}px rgba(240,68,56,${0.13 - pulse * 0.04})`,
        }}
      />
    </Scene>
  );
};

const EditView = () => {
  const frame = useCurrentFrame();
  const imageIn = spring({frame, fps: 30, config: {damping: 20, stiffness: 80}});
  const copyIn = spring({frame: frame - 18, fps: 30, config: {damping: 20, stiffness: 85}});
  const cursorProgress = interpolate(frame, [32, 100], [0, 1], {...clamp, easing: Easing.inOut(Easing.ease)});
  const cursorX = interpolate(cursorProgress, [0, 1], [1190, 990]);
  const cursorY = interpolate(cursorProgress, [0, 1], [320, 397]);
  const click = interpolate(frame, [102, 112, 126], [0, 1, 0], clamp);
  const typedChars = Math.floor(interpolate(frame, [118, 172], [0, 17], clamp));
  const quickText = '14:00–15:00 Study'.slice(0, typedChars);

  return (
    <Scene>
      <Background />
      <div style={{position: 'absolute', left: 112, top: 78}}>
        <Wordmark size={24} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 84,
          top: 132,
          transform: `translateY(${interpolate(imageIn, [0, 1], [48, 0])}px)`,
        }}
      >
        <BrowserFrame src="edit-mode.jpg" width={1400} x={-260} y={90} scale={1.08} />
      </div>
      <div
        style={{
          position: 'absolute',
          right: 112,
          top: 230,
          width: 580,
          transform: `translateY(${interpolate(copyIn, [0, 1], [34, 0])}px)`,
        }}
      >
        <div style={{color: colors.red, fontSize: 21, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase'}}>
          Plan your way
        </div>
        <h2 style={{margin: '20px 0 22px', color: colors.ink, fontSize: 76, lineHeight: 0.99, letterSpacing: '-0.055em'}}>
          Shape the day in seconds.
        </h2>
        <p style={{margin: 0, color: colors.muted, fontSize: 27, lineHeight: 1.4, letterSpacing: '-0.02em'}}>
          Drag. Resize. Quick-add. Your schedule stays fast and flexible.
        </p>
        <div
          style={{
            marginTop: 38,
            height: 62,
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            border: `1px solid ${colors.line}`,
            borderRadius: 10,
            background: colors.panel,
            boxShadow: '0 12px 35px rgba(23,23,23,.07)',
            color: quickText ? colors.ink : colors.muted,
            fontSize: 22,
          }}
        >
          {quickText || 'Quick add an event'}
          {frame >= 118 && frame < 190 && <span style={{width: 2, height: 28, marginLeft: 2, background: colors.red, opacity: frame % 18 < 10 ? 1 : 0}} />}
        </div>
        <div style={{display: 'flex', gap: 12, marginTop: 18}}>
          <Label>Drag</Label>
          <Label>Resize</Label>
          <Label>Undo</Label>
        </div>
      </div>
      <Cursor x={cursorX} y={cursorY} click={click} />
    </Scene>
  );
};

const ImportView = () => {
  const frame = useCurrentFrame();
  const imageIn = spring({frame, fps: 30, config: {damping: 18, stiffness: 78}});
  const wordsIn = spring({frame: frame - 20, fps: 30, config: {damping: 18, stiffness: 86}});
  const sweep = interpolate(frame, [50, 170], [-520, 660], {...clamp, easing: Easing.inOut(Easing.ease)});

  return (
    <Scene>
      <Background />
      <div style={{position: 'absolute', left: 112, top: 76}}>
        <Wordmark size={24} />
      </div>
      <div
        style={{
          position: 'absolute',
          right: -136,
          top: 150,
          transform: `translateY(${interpolate(imageIn, [0, 1], [56, 0])}px)`,
        }}
      >
        <BrowserFrame src="import-calendar.jpg" width={1380} x={190} y={60} scale={1.12} />
        <div
          style={{
            position: 'absolute',
            left: 510,
            top: 214,
            width: 530,
            height: 405,
            border: '2px solid rgba(240,68,56,.45)',
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '-100px auto -100px',
              left: sweep,
              width: 150,
              transform: 'skewX(-18deg)',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.42), transparent)',
            }}
          />
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 112,
          top: 262,
          width: 610,
          transform: `translateY(${interpolate(wordsIn, [0, 1], [30, 0])}px)`,
        }}
      >
        <div style={{color: colors.red, fontSize: 21, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase'}}>
          Start from reality
        </div>
        <h2 style={{margin: '20px 0 22px', color: colors.ink, fontSize: 74, lineHeight: 1, letterSpacing: '-0.055em'}}>
          Bring calendars in. Keep edits yours.
        </h2>
        <p style={{margin: 0, width: 520, color: colors.muted, fontSize: 27, lineHeight: 1.42, letterSpacing: '-0.02em'}}>
          Merge Google Calendar or ICS events without changing the source.
        </p>
        <Label style={{marginTop: 34}}><Dot /> Read-only import</Label>
      </div>
    </Scene>
  );
};

const Closing = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = spring({frame, fps, config: {damping: 16, stiffness: 88}});
  const chips = spring({frame: frame - 20, fps, config: {damping: 20, stiffness: 85}});
  const ring = interpolate(frame, [0, 120], [0.86, 1.08], {...clamp, easing: Easing.out(Easing.ease)});

  return (
    <Scene>
      <Background dark />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '46%',
          width: 760,
          height: 760,
          borderRadius: 999,
          border: '1px solid rgba(247,247,244,.07)',
          transform: `translate(-50%, -50%) scale(${ring})`,
          boxShadow: 'inset 0 0 0 84px rgba(247,247,244,.012), inset 0 0 0 168px rgba(247,247,244,.01)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          transform: `translateY(${interpolate(pop, [0, 1], [50, 0])}px)`,
        }}
      >
        <div style={{marginBottom: 50}}><Wordmark light size={34} /></div>
        <h2 style={{margin: 0, color: colors.paper, fontSize: 105, lineHeight: 0.98, letterSpacing: '-0.065em'}}>
          One calm plan.
          <br />
          All day.
        </h2>
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginTop: 46,
            opacity: chips,
            transform: `translateY(${interpolate(chips, [0, 1], [24, 0])}px)`,
          }}
        >
          <Label tone="light">Local-first</Label>
          <Label tone="light">Read-only imports</Label>
          <Label tone="light">No build step</Label>
        </div>
      </div>
      <div style={{position: 'absolute', bottom: 58, left: 0, right: 0, textAlign: 'center', color: '#878a8f', fontSize: 18, letterSpacing: '0.06em'}}>
        FOCUS ON TODAY
      </div>
    </Scene>
  );
};

export const ScheduleForTheDayPR = () => (
  <AbsoluteFill style={{fontFamily: font, background: colors.paper}}>
    <Sequence from={0} durationInFrames={120}>
      <Opening />
    </Sequence>
    <Sequence from={120} durationInFrames={195}>
      <FocusView />
    </Sequence>
    <Sequence from={315} durationInFrames={195}>
      <EditView />
    </Sequence>
    <Sequence from={510} durationInFrames={135}>
      <ImportView />
    </Sequence>
    <Sequence from={645} durationInFrames={75}>
      <Closing />
    </Sequence>
  </AbsoluteFill>
);
