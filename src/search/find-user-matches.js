// @ts-check

/**
* @param {string} searchText
* @param {import('..').UserEntry[]} userList
*/
export function findUserMatches(searchText, userList) {
  if (!searchText) return;

  const mushMatch = new RegExp([...searchText.replace(/[^a-z0-9]/gi, '')].join('.*'), 'i');
  const mushMatchLead = new RegExp('^' + [...searchText.replace(/[^a-z0-9]/gi, '')].join('.*'), 'i');

  const searchWordRegExp = new RegExp(
    searchText.split(/\s+/)
      // sort longer words match first
      .sort((w1, w2) => w2.length - w1.length || (w1 > w2 ? 1 : w1 < w2 ? -1 : 0))
      // generate a regexp out of word
      .map(word => '(' + word.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&') + ')')
      .join('|'),
    'gi');

  /** @type {{ user: import('..').UserEntry, rank: number }[]} */
  const matches = [];
  for (const user of userList) {
    let rank = 0;

    if (user.displayName) {
      searchWordRegExp.lastIndex = 0;
      while (true) {
        const match = searchWordRegExp.exec(user.displayName);
        if (!match) break;
        rank += (match[0].length / user.displayName.length) * 20;
        if (match.index === 0) rank += 30;
      }

      if (mushMatch.test(user.displayName)) rank += 3;
      if (mushMatchLead.test(user.displayName)) rank += 5;
    }

    searchWordRegExp.lastIndex = 0;
    while (true) {
      const match = searchWordRegExp.exec(user.shortHandle);
      if (!match) break;
      rank += (match[0].length / user.shortHandle.length) * 30;
      if (match.index === 0) rank += 40;
    }

    if (mushMatch.test(user.shortHandle)) rank += 3;
    if (mushMatchLead.test(user.shortHandle)) rank += 5;

    if (rank) matches.push({ user, rank });
  }

  matches.sort((m1, m2) => m2.rank - m1.rank);
  return matches?.length ? matches : undefined;
}