-- Recipes read from a photo (FEATURE_RECIPE_PHOTO_IMPORT_ENABLED). The photos themselves are
-- never stored; the included companion only counts reads per person per day for its own cap.
-- Tokens of a read add to input_tokens and output_tokens, so the monthly spend estimate covers them.
alter table ai_house_usage add column imports integer not null default 0;
