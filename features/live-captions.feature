Feature: Hearing the talk while it is still happening
  The transcript is written at Stop, from the whole file. Before that, Blab
  shows what the microphone is saying as short previews under the meter — so a
  talk that will not transcribe (noise, a mic that is too far) is obvious
  while it can still be fixed.

  Background:
    Given Blab is open with a folder connected

  Scenario: A caption appears while recording
    When I press Record
    And I speak into the microphone
    Then a line appears under the meter with the time it was heard at

  Scenario: Silence makes no captions
    When I press Record
    And I stay quiet
    Then no caption appears

  Scenario: Captions are previews, never the transcript
    Given a caption is showing
    When I press Stop
    Then the saved transcript is made from the whole recording
