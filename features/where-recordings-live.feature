Feature: Recordings live on one laptop
  A recording is somebody's voice and their notes about it. It belongs on the
  machine it was made on, and Blab neither uploads it nor packages it: a fresh
  install ships with no recordings in it, and gets them only once somebody
  points it at a folder of their own.

  There is exactly one way that has ever broken, and it is not the network. Blab
  writes each recording into whichever folder was picked, so picking a git
  checkout leaves the audio sitting in a working tree, one `git add -A` from
  being pushed to a repository other people can read. So those folders are
  refused. Not ignored, not warned about — refused. A .gitignore line is the
  wrong answer twice over: it protects only the one checkout somebody thought to
  edit, and it makes a private recording's safety the maintainer's job.

  Scenario: A fresh install has nothing in it
    Given I have just installed Blab and never run it
    Then there are no recordings anywhere in it
    And it asks me to pick a folder before it will record

  Scenario: The folder is remembered on this machine
    Given I picked a folder and recorded into it
    When I close Blab and open it again
    Then the folder is still connected and my transcripts are listed
    # Remembered in this browser profile, on this laptop. Nothing about that
    # folder is written anywhere that another machine could read.

  Scenario: I can move to a different folder
    When I press Change folder and pick another
    Then recordings from then on go into the new one
    And the ones in the old folder are left exactly where they are

  Scenario: A git checkout is refused
    When I pick a folder that is a git repository
    Then Blab names the repository and refuses to use it
    And the folder I was already using is still the one in use
    And the picker does not reopen over the message that says why

  Scenario: A folder deep inside a checkout is refused too
    Given a repository with a notes folder three levels down
    When I pick that folder
    Then it is refused for the same reason
    # The page cannot see this: a directory handle has no path and no parent.
    # The shell watched the folder being granted and knows where it is.

  Scenario: A worktree or a submodule counts as a checkout
    Given a folder whose .git is a file rather than a directory
    When I pick it
    Then it is refused, because `git add -A` there does the same thing

  Scenario: A folder remembered from a version that allowed it
    Given Blab remembers a checkout picked before this was refused
    When Blab starts
    Then it does not connect to it
    And it forgets it rather than offering it again
    And it says why, and asks for a folder outside the repository
