// Test-only (never loaded in production): node --require this file to fake GitHub's /user/repos for local sessions
// minted by tools/mint.mjs (token "fake:<login>"). Other GitHub reads go to the real public API without a token.
const real = globalThis.fetch;
const REPOS = {
  samsagewize: [['rain-world', 'Rain\u2019s World, a cozy pixel world', 12, 'JavaScript'], ['gitworld', 'Git it together at GitWorld', 8, 'JavaScript'], ['Rooms', 'Clubhouse-style audio rooms', 21, 'TypeScript']],
  octocat: [['Hello-World', 'My first repository on GitHub!', 3000, ''], ['Spoon-Knife', 'This repo is for demonstration purposes only.', 13000, 'HTML'], ['linguist', 'Language savant.', 400, 'Ruby'], ['octocat.github.io', '', 900, 'CSS']]
};
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://api.github.com')) {
    const h = new Headers(init.headers || {}); const tok = (h.get('authorization') || '').replace(/^Bearer /, '');
    if (tok.startsWith('fake:')) {
      const login = tok.slice(5);
      if (url.includes('/user/repos')) {
        const list = (REPOS[login.toLowerCase()] || [['hello-' + login, 'Side project of ' + login, 2, 'Go'], ['dotfiles', 'My dotfiles', 0, 'Shell'], ['notes', 'Notes', 1, '']]).map(([n, d, s, l]) => ({ full_name: login + '/' + n, description: d, stargazers_count: s, language: l, fork: false, private: false, owner: { login } }));
        return new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } });
      }
      h.delete('authorization'); init = { ...init, headers: h };
    }
  }
  return real(input, init);
};
