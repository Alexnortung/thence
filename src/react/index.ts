/**
 * thence/react: hooks for rendering a session with React. `useValue` reads
 * the value a path names, `useWritable` also sets it, and `useEntries` reads
 * a list's rows or a map's entries, each re-rendering only when what it
 * reads changes. A path starts at a session or an entity's handle, or at the
 * root of the session `SessionProvider` gives. React is an optional peer dependency: the
 * rest of thence doesn't need it.
 *
 * Not one of thence's modules: it only uses the session's public handles.
 *
 * @module
 */

export { SessionProvider, useEntries, useValue, useWritable } from "./hooks";
export type * from "./types";
