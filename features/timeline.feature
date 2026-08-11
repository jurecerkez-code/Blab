Feature: One time axis for the notes and the transcript
  A two hour lecture is a wall of text you will never read again. Whisper
  already knows when each phrase was said and hands the times over as part of
  the same work, so every transcript line carries the second it starts at, and
  every note carries the second it was typed. That makes both files an index
  into the audio: click a line, hear it.

  The two agree because a pause writes nothing. Recorded time and position in
  audio.webm are the same number even when the talk had a break in the middle.

  Background:
    Given Blab is open with a folder connected

  Scenario: The transcript says when
    Given I have recorded and transcribed a talk
    Then every line of transcript.md begins with the time it was said at
    And the times count from the start of the recording, not from the clock
    And the words themselves are unchanged

  Scenario: The full transcript is still the full transcript
    Given a transcript with a hundred lines in it
    Then all one hundred are in transcript.md
    And nothing has been shortened, merged or dropped

  Scenario: A note takes the time it was started
    Given I am recording
    When I begin typing a note fourteen minutes in
    And I keep typing the same line until fifteen minutes in
    Then that line is saved with fourteen minutes in front of it
    Because that is when I heard the thing I am writing down

  Scenario: Each line of notes gets its own time
    Given I am recording
    When I write one note early and another an hour later
    Then each line carries its own time
    And neither is moved by the other

  Scenario: Going back to fix a typo does not move the line
    Given I wrote a note at thirty seconds
    When I correct a word in it two minutes later
    Then the line keeps its original time

  Scenario: Notes typed before Record keep no time
    Given no recording is in progress
    When I type into the notes box
    And I never press Record
    Then those lines are saved exactly as they were typed
    And no time is invented for them

  Scenario: A pause does not push the notes out of step
    Given I am recording
    When I pause for ten minutes and then resume
    And I write a note straight after resuming
    Then the note's time matches where that moment sits in audio.webm
    And it does not include the ten minutes that were never recorded

  Scenario: Clicking a line plays from there
    Given I am reading a recording with times in it
    When I click a transcript line
    Then the player jumps to that second and plays
    And clicking a note line does the same

  Scenario: A recording made before any of this still opens
    Given a transcript.md written by an older version of Blab, with no times
    Then it is shown as it always was
    And no line pretends to be clickable
    And no time is guessed for it

  Scenario: The times survive the folder
    Given a recording with times
    When I open transcript.md and notes.md in any text editor
    Then the times are readable there too
    And the files are still plain text with nothing hidden in them
