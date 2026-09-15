Feature: Choosing the model that suits the machine
  Whisper ships in sizes, and the right one depends on the laptop: the small
  model is noticeably more accurate and the medium model more still, but both
  take longer than the fast default. Blab ships with the fast model installed
  and offers the others through `npm run setup`.

  Background:
    Given Blab is open with a folder connected

  Scenario: The picker shows what is installed
    When I look at the model picker
    Then each model is listed with its speed
    And models not installed say so

  Scenario: The choice is remembered
    When I pick the Balanced model
    Then the next time Blab opens, Balanced is still selected
    And transcription uses the Balanced weights

  Scenario: The choice is disabled while recording
    When I press Record
    Then the model picker cannot change
