import os
import tempfile


# Configure the process before pytest imports application modules so isolated or
# differently ordered test runs never resolve runtime paths under real user data.
TEST_PROCESS_HOME = tempfile.TemporaryDirectory(
    prefix="audux-pytest-home-"
)
os.environ["AUDUX_DATA_DIR"] = TEST_PROCESS_HOME.name
