-- People's own photos. The person confirms they took it or may use it (copyright stays with
-- them, see docs/content-policy.md); the time of that confirmation and where the upload came
-- from (the app or a connected assistant) are kept for takedown handling.
alter table recipe_images drop constraint recipe_images_kind_check;
alter table recipe_images add constraint recipe_images_kind_check check (kind in ('photo', 'generated', 'upload'));
alter table recipe_images add column rights_confirmed_at timestamptz;
alter table recipe_images add column upload_source text check (upload_source in ('app', 'assistant'));
alter table recipe_images add constraint recipe_images_upload_rights
  check ((kind = 'upload') = (rights_confirmed_at is not null and upload_source is not null));
