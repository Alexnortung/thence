/** Any JSON value. Ops, snapshots, errors and `t.json` values are all `Json`. */
export type Json =
	| null
	| boolean
	| number
	| string
	| readonly Json[]
	| { readonly [key: string]: Json };
