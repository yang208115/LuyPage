ALTER TABLE workspace_state ADD COLUMN homepage_preferences TEXT NOT NULL
  DEFAULT '{"wallpaperId":"sunset-fields","searchProvider":"bing","showClock":true,"showCalendar":true}'
  CHECK(json_valid(homepage_preferences));
