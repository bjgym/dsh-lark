/**
 * One question, asked of the filesystem instead of of a string: is this path
 * inside that directory?
 *
 * Both directions of a file transfer have to ask it, and neither can answer it
 * with `resolve`. A path that string-resolves under the workspace still reads
 * and writes wherever a symlink along it points, so the answer has to come from
 * the canonical form of what the filesystem actually holds — outbound before it
 * takes bytes out of a workspace (ADR 0004), inbound before it puts bytes into
 * a directory it just made.
 *
 * The COMPARISON is the filesystem's too, and that is the second thing a string
 * cannot answer. `C:\Work` and `c:\work` are one directory on Windows and two on
 * a POSIX host; `===` and `startsWith` answer that question with the rules of
 * whichever platform the author had in mind, which is how a Windows operator's
 * own configured root — or their own home directory — comes back as a foreign
 * path. Both functions below compare with `relative`, which folds case exactly
 * where the host folds it and nowhere else.
 * @module dsh-lark-channel/containment
 */

import { realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'

/**
 * One path's canonical form, or undefined when the filesystem will not produce
 * one — nothing there, a dangling link, a component it will not traverse.
 * @param path - an absolute path.
 * @returns the canonical path, or undefined.
 */
export function canonicalPathOf(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/**
 * Whether two paths name the same location.
 *
 * A path that is not absolute answers false rather than being read against the
 * process working directory: this asks about a place, and a spelling that never
 * named one must not quietly borrow the cwd's meaning.
 * @param left - an absolute path.
 * @param right - an absolute path.
 * @returns true when both name the same location.
 */
export function isSamePath(left: string, right: string): boolean {
  return isAbsolute(left) && isAbsolute(right) && relative(left, right) === ''
}

/**
 * Whether one path sits at or inside a container directory.
 *
 * Spelled out here rather than reached for from `workspaceRoots`: an allow-list
 * that reads an empty list as "anywhere at all" has no business under a
 * security check. What IS shared is the comparison itself, so that "is this
 * under that" exists once and cannot be fixed for case folding in one caller
 * and left broken in the other.
 *
 * The `..` test is by COMPONENT and not by prefix: `relative` answers `..foo`
 * for a child that really carries that name, and reading that as the parent
 * would refuse a file whose name merely begins with two dots.
 * @param path - an absolute path.
 * @param container - an absolute directory.
 * @returns true when the path is the container or below it.
 */
export function isWithinContainer(path: string, container: string): boolean {
  if (!isAbsolute(path) || !isAbsolute(container)) return false
  const within = relative(container, path)
  // A path on another drive comes back absolute rather than relative: Windows
  // has no `..` that reaches across one.
  return within === '' || (!isAbsolute(within) && within !== '..' && !within.startsWith(`..${sep}`))
}
