/**
 * thence/react: hooks for rendering a session with React. `useValue` reads a
 * member and `useEntries` a list's rows or a map's entries, each re-rendering
 * only when what it reads changes. React is an optional peer dependency: the
 * rest of thence doesn't need it.
 *
 * Not one of thence's modules: it only uses the session's public handles.
 *
 * @module
 */

export { useEntries, useValue } from "./hooks";
export type * from "./types";
