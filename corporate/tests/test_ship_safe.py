"""Nothing real about a real person may ship in this folder.

Three sweeps:

1. Every proper name in the pretend events and in the two screens' words is on
   the allowlist the contract pins.  Real famous songs are fine, but the exact
   song lines are pinned too, so a real client's request cannot wander in.
2. No file here spells this Mac's home-folder path, or the tail a session
   scratch folder is named with.  Both spellings are built from pieces so this
   file does not contain either of them; VERIFY.md describes them in words.
3. A handful of real surnames from this Mac's other work must not appear.  They
   are pinned by the first eight characters of their sha256, so the names
   themselves never enter the repository — and the sweep proves its own eyes on
   a name that IS here before it trusts a clean answer on the ones that are not.
"""

import hashlib
import json
import re
import unittest

from .helpers import CORPORATE

FIXTURES = CORPORATE / "fixtures"

# CONTRACT.md section 9 — these invented names are the whole allowlist.
ALLOWED_NAMES = {
    "Harbor", "Studio", "Networking", "Dana", "Whitfield", "Priya", "Raman",
    "Pier", "Loft", "San", "Francisco",
    "Northstar", "Staff", "Awards", "Logistics", "Theo", "Marsh", "Jules",
    "Okafor", "Sam", "Reyes", "Mina", "Park", "Lakeside", "Hall", "Chicago",
    "Siobhan", "VAWN",   # from the pinned pronunciation note "Siobhan - shi-VAWN"
}

# Ordinary words that happen to be capitalised in a label, a room or a screen.
SAFE_WORDS = {
    "Arrival", "Dinner", "Dancing", "Closing", "Main", "Atrium", "The",
    "Miles", "Savvy", "Sounds", "Screen", "This", "America", "Chicago",
    "Los", "Angeles",
}

# The exact song lines the pretend events carry.  Famous records, pinned.
PINNED_SONGS = {
    "Stevie Wonder - Signed, Sealed, Delivered",
    "Kool & The Gang - Celebration",
    "Baha Men - Who Let The Dogs Out",
    "Earth, Wind & Fire - September",
}

SONG_FIELDS = ("requests", "dnp_songs", "must_plays", "awards_walkon",
               "dancing_opener", "dancing_closer", "playlist_links")

# Built from pieces on purpose: this file must not contain either spelling whole.
HOME_PATH = "/Us" + "ers/" + "mile" + "sdipaola"
SCRATCH_TAIL = "-Us" + "ers-" + "mile" + "sdipaola"
SCRATCH_ROOT = "/tmp/" + "clau" + "de-"

# First eight hex of sha256 of two real surnames.  The names are never spelled.
NEEDLE_HASHES = ("44f93692", "489f5524")

SKIP_FOLDERS = {"__pycache__", "frames"}
NAME = re.compile(r"[A-Z][A-Za-z'’-]+")
WORD = re.compile(r"[a-z]+")


def every_file():
    for path in sorted(CORPORATE.rglob("*")):
        if not path.is_file():
            continue
        if SKIP_FOLDERS.intersection(path.relative_to(CORPORATE).parts):
            continue
        yield path


def read(path):
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return ""


def word_hashes(text):
    """Every lowercase word in this text, as an eight-character fingerprint."""
    return {hashlib.sha256(word.encode("utf-8")).hexdigest()[:8]
            for word in WORD.findall(text.lower())}


def identity_strings(fixture):
    """The places a person, a company or a place is named."""
    out = [("name", fixture["name"]), ("company", fixture["company"])]
    for person in fixture["people"]:
        out.append(("people", person["name"]))
    answers = fixture["answers"]
    for qid in ("event_name", "company", "contact_name", "approver_name",
                "day_of_contact", "planner_name", "production_contact",
                "venue", "city", "awards_pronunciation"):
        if qid in answers:
            out.append((qid, answers[qid]))
    for moment in fixture["moments"]:
        out.append((moment["moment_id"], moment.get("label") or ""))
        out.append((moment["moment_id"], moment.get("room") or ""))
        out.append((moment["moment_id"], moment.get("pronunciation") or ""))
    return out


def screen_words(text):
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.S)
    text = re.sub(r"<script.*?</script>", " ", text, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return NAME.findall(text)


class Fixtures(unittest.TestCase):
    def fixtures(self):
        return [json.loads(p.read_text(encoding="utf-8"))
                for p in sorted(FIXTURES.glob("*.json"))]

    def test_there_are_exactly_the_two_pretend_events(self):
        self.assertEqual(sorted(p.name for p in FIXTURES.glob("*.json")),
                         ["harbor-studio.json", "northstar-awards.json"])

    def test_every_name_in_them_is_one_we_invented(self):
        allowed = ALLOWED_NAMES | SAFE_WORDS
        for fixture in self.fixtures():
            for where, value in identity_strings(fixture):
                for token in NAME.findall(str(value)):
                    self.assertIn(token, allowed,
                                  "%s in %s is not on the allowlist" % (token, where))

    def test_the_song_lines_are_the_ones_we_pinned(self):
        found = set()
        for fixture in self.fixtures():
            for qid in SONG_FIELDS:
                value = fixture["answers"].get(qid)
                if isinstance(value, list):
                    found.update(value)
                elif isinstance(value, str) and value.strip():
                    found.add(value)
        self.assertEqual(found, PINNED_SONGS)

    def test_the_screens_say_no_names_we_did_not_invent(self):
        allowed = ALLOWED_NAMES | SAFE_WORDS
        for folder in ("client", "dj"):
            for page in sorted((CORPORATE / folder).glob("*.html")):
                for token in screen_words(read(page)):
                    self.assertIn(token, allowed,
                                  "%s in %s is not on the allowlist"
                                  % (token, page.name))


class PersonalPaths(unittest.TestCase):
    def test_nothing_here_spells_this_macs_home_folder_or_a_session_scratch_root(self):
        walked = 0
        for path in every_file():
            walked += 1
            text = read(path)
            where = path.relative_to(CORPORATE)
            self.assertNotIn(HOME_PATH, text, "%s names the home folder" % where)
            self.assertNotIn(SCRATCH_TAIL, text, "%s names the home folder" % where)
            self.assertNotIn(SCRATCH_ROOT, text, "%s names a session scratch root" % where)
        self.assertGreater(walked, 15, "the sweep walked almost nothing — check it")

    def test_the_sweep_would_see_one_if_it_were_there(self):
        poisoned = "cd " + HOME_PATH + "/Projects/x && ./run-all.sh"
        self.assertIn(HOME_PATH, poisoned)
        clean = "cd ~/Projects/x && ./run-all.sh"
        self.assertNotIn(HOME_PATH, clean)


class BannedSurnames(unittest.TestCase):
    def test_the_matcher_finds_a_name_that_is_definitely_here(self):
        """Prove the eyes on the real walk before trusting a clean answer."""
        present = hashlib.sha256(b"northstar").hexdigest()[:8]
        seen = set()
        for path in every_file():
            seen |= word_hashes(read(path))
        self.assertIn(present, seen,
                      "the matcher cannot even find a name we know is here")

    def test_no_real_surname_from_this_macs_other_work_appears(self):
        for path in every_file():
            found = word_hashes(read(path)).intersection(NEEDLE_HASHES)
            self.assertEqual(found, set(),
                             "%s carries a real surname" % path.relative_to(CORPORATE))

    def test_the_needles_are_fingerprints_and_not_the_names_themselves(self):
        self.assertEqual(len(NEEDLE_HASHES), 2)
        for needle in NEEDLE_HASHES:
            self.assertRegex(needle, r"^[0-9a-f]{8}$")
