Feature: Recording an online meeting
  A laptop microphone in a room hears the room. A laptop microphone in a video
  call hears one person: whoever is sitting at it. Everyone else arrives as
  sound coming out of the speakers, which is either re-recorded badly or, on
  headphones, not recorded at all.

  So Blab records two things at once and writes them as one file: what the
  computer is playing, and the microphone. That covers a meeting without Blab
  knowing anything about meetings.

  It does not join the call. There is no bot, no meeting link, no calendar, no
  account, no API, and nothing on the other end that has to be trusted. Blab
  cannot tell Zoom from Teams from a video on a website, and does not need to.
  Whatever the speakers are playing is what gets recorded, which is why this
  works on the next tool as well as this one, and why it keeps the promise the
  rest of the app makes: nothing leaves the machine.

  Two things it honestly cannot do. It cannot say who spoke — Whisper writes
  words, not names, so a meeting transcript is one run of speech with no labels
  on it. And it cannot record system audio on a Mac: Electron's loopback capture
  is Windows only, and going around that means asking people to install a
  virtual audio device, which is a different app than this one.

  Background:
    Given Blab is open with a folder connected
    And the microphone has been granted to Blab

  # ------------------------------------------------------------------ the choice

  Scenario: The default is unchanged
    Given I have never touched the meeting setting
    When I press Record
    Then only the microphone is recorded
    And Blab behaves exactly as it did before this existed

  Scenario: Turning it on
    Given I am on Windows
    Then there is a control beside Record for including what the computer plays
    And it is off until I turn it on
    And my choice is remembered the same way my folder and my language are

  Scenario: The choice cannot be changed mid-recording
    Given I am recording with the meeting setting on
    Then the control is disabled until I press Stop
    Because a file that changes what it contains halfway through is worse than
    one that does not

  # ------------------------------------------------------------------ capturing

  Scenario: Both sides land in one file
    Given the meeting setting is on
    When I press Record
    And someone on the call speaks
    And I speak into my microphone
    Then both are in audio.webm
    And there is still exactly one audio.webm
    And the folder holds the same three files it always did

  Scenario: The two are mixed before Whisper sees them
    Given a recording made with the meeting setting on
    Then the two sources are mixed to one mono channel
    And that channel is what is transcribed
    Because Whisper reads one channel and a meeting is not two recordings

  Scenario: Neither side drowns the other
    Given the call is much louder than my microphone
    Then both are still legible in the transcript
    And no source is scaled so far down that Whisper stops hearing it

  Scenario: What the meeting hears does not change
    When I record with the meeting setting on
    Then the other people on the call hear exactly what they would have heard
    And nothing is injected into the call
    And my own speakers keep playing normally, so I can still follow it

  # ------------------------------------------------------------------ knowing it works

  Scenario: The meter shows both sources separately
    Given the meeting setting is on
    When I press Record
    Then there is one row of bars for the call and one for my microphone
    And each moves only with its own source
    Because a dead microphone and a call that is not being captured are two
    different problems with two different fixes

  Scenario: A silent call is visible immediately
    Given the meeting setting is on
    And nothing is playing through the speakers
    When someone on the call speaks
    Then the call's bars stay flat
    And I can tell before pressing Stop that the call is not being captured

  Scenario: Speakers instead of headphones
    Given the meeting setting is on
    And I am listening on speakers rather than headphones
    Then Blab says once that headphones give a better transcript
    And it does not refuse to record
    Because the microphone re-recording the speakers gives every word twice, and
    Whisper handles that badly

  # ------------------------------------------------------------------ when it will not

  Scenario: On a Mac the control is not offered
    Given I am on macOS
    Then the meeting control is not shown
    And nothing in the interface implies it is coming
    And the microphone still records exactly as it always did

  Scenario: Refusing the capture prompt
    Given the meeting setting is on
    When I press Record
    And Windows asks what to capture and I cancel it
    Then Blab says the call will not be recorded and the microphone still will
    And it offers to record the microphone alone rather than recording nothing

  Scenario: The system audio stops mid-recording
    Given I am recording with the meeting setting on
    When the capture ends before I press Stop
    Then the microphone keeps recording
    And what was already captured is kept
    And Blab says so, rather than failing at the end when it is too late to fix

  Scenario: Recording still survives a meeting that never starts
    Given the meeting setting is on
    And nothing is ever played through the speakers
    When I record and press Stop
    Then the file holds my microphone
    And it transcribes normally

  # ------------------------------------------------------------------ the rest of Blab

  Scenario: Everything else works the same
    Given a recording made with the meeting setting on
    Then my notes are timed against it the same way
    And clicking a line plays from that second
    And the highlights are picked the same way
    And Copy all and the exports hold the full transcript

  Scenario: Pause still costs nothing
    Given I am recording a meeting
    When I pause for the ten minutes the call spends on someone else's screen share
    Then neither source is written while paused
    And the timer counts recorded time
    And resuming carries on into the same file

  Scenario: The transcript does not pretend to know who spoke
    Given a meeting transcript
    Then no line is labelled with a name
    And nothing in the interface suggests it could be
    Because guessing at speakers and being wrong is worse than not guessing

  # ------------------------------------------------------------------ the part that is not technical

  Scenario: It is obvious that recording is happening
    Given I am recording a meeting
    Then the window makes it plain, the same way it already does
    Because the people on the call cannot see my screen, and whether to tell
    them is mine to get right

  Scenario: Nothing about the call is collected
    Given a meeting recording
    Then Blab has stored no participant, no meeting title, no link and no account
    And the folder holds audio, notes and a transcript, as it does for a lecture
    And no request leaves the machine at any point

  # ------------------------------------------------------------------ shipping it

  Scenario Outline: What each platform gets
    Given Blab is running on <platform>
    Then the meeting control is <offered>
    And the microphone works as it always has

    Examples:
      | platform   | offered     |
      | Windows 11 | shown       |
      | Windows 10 | shown       |
      | macOS      | not shown   |

  Scenario: It costs nothing to ship
    Then no dependency is added to package.json
    And no model is downloaded for this
    And the installer is the same size it was
    And the recording folder format is unchanged
