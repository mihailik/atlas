// @ts-check

import { constructStateAndRun } from './construct-state-and-run';

/** @param {{ [shortDID: string]: import('..').UserTuple }} rawUsers */
export async function runWebglGalaxy(rawUsers) {
  constructStateAndRun(rawUsers);

}