"""One writer for durable corporate prep data, enforced from source."""

import unittest
from pathlib import Path


CORPORATE = Path(__file__).resolve().parent.parent
SCRIPT = CORPORATE / "script"
GS_WRITER = "store.gs"
MJS_WRITER = "load.mjs"
GS_WRITES = ("DriveApp", "setContent", "createFile", "setTrashed")
MJS_WRITES = ("writeFileSync", "renameSync", "unlinkSync", "rmSync", "mkdirSync")


def mentions(text, calls):
    return sorted(call for call in calls if call in text)


class OneWriter(unittest.TestCase):
    def test_only_store_reaches_the_google_writer(self):
        files = sorted(SCRIPT.glob("*.gs"))
        self.assertIn(SCRIPT / GS_WRITER, files)
        for path in files:
            found = mentions(path.read_text(encoding="utf-8"), GS_WRITES)
            if path.name == GS_WRITER:
                self.assertTrue(found)
            else:
                self.assertEqual(found, [], "%s writes Drive data; it must go through store.gs" % path.name)

    def test_only_the_loader_shim_reaches_the_disk_writer(self):
        files = sorted(SCRIPT.glob("*.mjs"))
        self.assertIn(SCRIPT / MJS_WRITER, files)
        for path in files:
            found = mentions(path.read_text(encoding="utf-8"), MJS_WRITES)
            if path.name == MJS_WRITER:
                self.assertTrue(found)
            else:
                self.assertEqual(found, [], "%s writes files; it must go through load.mjs" % path.name)

    def test_this_check_can_actually_see_a_break(self):
        clean = (SCRIPT / "rules.gs").read_text(encoding="utf-8")
        self.assertEqual(mentions(clean, GS_WRITES), [])
        self.assertEqual(mentions(clean + "\nDriveApp.createFile('x');\n", GS_WRITES),
                         ["DriveApp", "createFile"])


if __name__ == "__main__":
    unittest.main()
