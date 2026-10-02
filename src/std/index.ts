/**
 * std: the function library, as ordinary \`fn()\` values a kit spreads into
 * \`functions\`. It holds inverses, lazy parameters and the descriptors of
 * incremental aggregates; the engine does the folding.
 *
 * A shell so far.
 *
 * @module
 */

import { shell } from "../shell";

/** the std functions, as a value to spread into kit({ functions }) */
export const std: { readonly "~std": true } = shell("std");
