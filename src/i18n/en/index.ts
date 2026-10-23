import type { Shape } from '../types'
import common from './common'
import units from './units'
import workout from './workout'
import diet from './diet'
import progress from './progress'
import rank from './rank'
import settings from './settings'
import components from './components'
import native from './native'
import notify from './notify'
import lib from './lib'
import ai from './ai'
import data from './data'
import library from './library'
import schemes from './schemes'
import programs from './programs'

/** The English dictionary: the source of truth for keys and the fallback for every language. */
export const en = { common, units, workout, diet, progress, rank, settings, components, native, notify, lib, ai, data, library, schemes, programs } as const

/** What every other language must provide (same keys, any strings). */
export type Dict = Shape<typeof en>
