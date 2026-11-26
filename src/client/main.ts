import { openAvatarBuilder } from './join/avatarBuilder';
import type { AvatarLook } from '@shared/types';

document.querySelector('#app')!.textContent = 'Team Lobby';

// Dev entry: /?avatar opens the avatar builder, /?avatar=skin,hair,hairColor,top,topColor,bottomsColor,accessory
// pre-fills it. The real join flow arrives in Task 9.
const q = new URLSearchParams(location.search);
if (q.has('avatar')) {
  const n = (q.get('avatar') ?? '').split(',').map(Number);
  const initial: AvatarLook | null = n.length === 7 && n.every(Number.isInteger)
    ? { skin: n[0]!, hair: n[1]!, hairColor: n[2]!, top: n[3]!, topColor: n[4]!, bottomsColor: n[5]!, accessory: n[6]! }
    : null;
  openAvatarBuilder(initial, (look) => console.log('avatar chosen', look));
}
