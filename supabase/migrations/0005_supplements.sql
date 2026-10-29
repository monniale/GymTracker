-- GymTracker cloud sync: lets the supplement tables through (`supplements`, `supplementLogs`).
-- Run once in the project's SQL editor BEFORE installing an app build with supplements: until
-- then `push_rows` refuses any batch holding one of their rows, and the sync stops with an error.
-- Running it again is harmless.

alter table public.rows drop constraint if exists rows_tbl_known;
alter table public.rows add constraint rows_tbl_known check (tbl in (
  'exercises', 'templates', 'sessions', 'sets', 'foods', 'foodLogs', 'savedMeals', 'settings',
  'rankState', 'scoreEvents', 'seasons', 'dayTypes', 'bodyLog', 'waterLogs', 'achievements',
  'quests', 'coachHistory', 'plannedFoods', 'programs', 'supplements', 'supplementLogs'));
