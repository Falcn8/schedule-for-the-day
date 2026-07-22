import React from 'react';
import {Composition} from 'remotion';
import {ScheduleForTheDayPR} from './video';

export const RemotionRoot = () => (
  <Composition
    id="ScheduleForTheDayPR"
    component={ScheduleForTheDayPR}
    durationInFrames={720}
    fps={30}
    width={1920}
    height={1080}
  />
);
