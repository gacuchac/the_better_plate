-- The included companion now also generates recipe photos (owner decision 2026-10-20: full
-- features, limited usage). Images are counted per person per day for their own cap, and priced
-- into the monthly spend estimate.
alter table ai_house_usage add column images integer not null default 0;
