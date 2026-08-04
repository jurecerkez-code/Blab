Feature: Live level meter while recording
  Blab shows nothing until Stop is pressed, so a dead microphone looks exactly
  like a working one until the recording is already over. A row of bars under
  the Record button moves with the voice, so silence is visible immediately.

  Background:
    Given Blab is open with a folder connected
    And the microphone has been granted to Blab

  Scenario: Bars are still before recording starts
    Given no recording is in progress
    Then the meter is flat
    And the bars are drawn in the idle colour

  Scenario: Bars move with the voice
    When I press Record
    And I speak into the microphone
    Then the bars rise within one animation frame of the sound
    And louder speech drives taller bars than quiet speech
    And the bars fall back gradually when I stop speaking

  Scenario: A dead microphone is obvious straight away
    Given the selected microphone captures silence
    When I press Record
    And I speak into the microphone
    Then the meter stays flat
    And I can tell the microphone is not being heard without pressing Stop

  Scenario: The meter never asks for the microphone a second time
    When I press Record
    Then the meter reads the same stream the recorder already opened
    And no second microphone permission prompt appears
    And exactly one microphone capture is open

  Scenario: Stopping releases everything
    Given I am recording
    When I press Stop
    Then the meter stops animating
    And the audio nodes are disconnected
    And the audio context is closed
    And the operating system stops showing Blab as using the microphone

  Scenario: Recording survives a meter that cannot start
    Given the browser refuses to create an audio context
    When I press Record
    Then recording starts anyway
    And the audio is saved when I press Stop
    And no error is shown that would suggest the recording failed

  Scenario: Repeated recordings do not accumulate resources
    When I record and stop five times in a row
    Then only one audio context exists at a time
    And no animation loop from an earlier recording is still running
    And memory use is comparable to after the first recording

  Scenario: The meter matches the existing dark interface
    Then the bars use the palette already defined in style.css
    And no new dependency is added to package.json

  Scenario Outline: The meter behaves the same on every supported machine
    Given Blab is running on <platform>
    And the microphone opens at <sample_rate>
    When I press Record
    And I speak into the microphone
    Then the bars respond across the same speech frequencies on every platform
    And the bar layout does not shift because of the sample rate

    Examples:
      | platform             | sample_rate |
      | Windows 11           | 48 kHz      |
      | macOS on Apple M1    | 44.1 kHz    |
      | macOS on Intel       | 44.1 kHz    |

  Scenario: The packaged macOS build covers both chips
    Given Blab is packaged for macOS
    Then the build produces a universal binary
    And the meter needs no architecture specific code
    And the meter needs no native module

  Scenario: A minimised window does not break the meter
    Given I am recording
    When the window is minimised so animation frames stop firing
    Then the recording keeps capturing audio
    And the bars resume when the window is shown again
    And pressing Stop still releases the meter cleanly
