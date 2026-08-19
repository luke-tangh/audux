import tempfile
from pathlib import Path


# Several application modules derive database, cover, log, and token paths at
# import time. Establish a process-wide temporary home before pytest imports any
# test module so isolated or differently ordered test runs never touch user data.
TEST_PROCESS_HOME = tempfile.TemporaryDirectory(
    prefix="audux-pytest-home-"
)
Path.home = lambda: Path(TEST_PROCESS_HOME.name)
