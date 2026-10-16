import type { SongIdentity } from '@haen/contracts';
export function songSearches(song: SongIdentity) {
  const query = `${song.artist} ${song.title}`;
  const encoded = encodeURIComponent(query);
  return [
    { name: '网易云音乐', href: 'https://music.163.com/#/search/m/?s=' + encoded },
    { name: 'QQ 音乐', href: 'https://y.qq.com/n/ryqq/search?w=' + encoded },
    { name: 'Spotify', href: 'https://open.spotify.com/search/' + encoded },
    { name: 'Apple Music', href: 'https://music.apple.com/us/search?term=' + encoded },
    {
      name: 'YouTube',
      href: 'https://www.youtube.com/results?' + new URLSearchParams({ search_query: query }),
    },
    { name: 'Google', href: 'https://www.google.com/search?' + new URLSearchParams({ q: query }) },
  ];
}
