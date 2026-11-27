import { describe, it, expect } from 'vitest';
import { teamLabel } from '@shared/teamLabel';
import { upBanner } from '@shared/game/calls';
import { callConfirmText } from '../../src/client/host/hostModel';

describe('teamLabel', () => {
  it('prefixes plain names and leaves "Team …" names alone', () => {
    expect(teamLabel('Otter')).toBe('Team Otter');
    expect(teamLabel('Team 1')).toBe('Team 1');
    expect(teamLabel('team rocket')).toBe('team rocket');
    expect(teamLabel('Teamwork')).toBe('Team Teamwork');
  });

  it('keeps the verbatim banner and confirm copy for plain names, without doubling "Team"', () => {
    expect(upBanner('Otter')).toBe("🎉 Team Otter, you're up! Head to the next activity.");
    expect(upBanner('Team 3')).toBe("🎉 Team 3, you're up! Head to the next activity.");
    expect(callConfirmText({ name: 'Pixel', score: 210 })).toBe('This will call TEAM PIXEL (210 pts)');
    expect(callConfirmText({ name: 'Team 2', score: 60 })).toBe('This will call TEAM 2 (60 pts)');
  });
});
