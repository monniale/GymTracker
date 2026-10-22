/** A pluralized message: `tp(key, n)` picks `one` or `other` with the language's plural rules. */
export interface Plural {
  one: string
  other: string
}

/** The shape every language must provide: the English dictionary with any string in each leaf. */
export type Shape<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends Plural ? Plural : Shape<T[K]>
}

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never

/** Dotted keys of the plain-string messages ("workout.home.title"). */
export type StringKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : T[K] extends Plural ? never : Join<K, StringKey<T[K]>>
}[keyof T & string]

/** Dotted keys of the pluralized messages. */
export type PluralKey<T> = {
  [K in keyof T & string]: T[K] extends string ? never : T[K] extends Plural ? K : Join<K, PluralKey<T[K]>>
}[keyof T & string]

export type Vars = Record<string, string | number>
