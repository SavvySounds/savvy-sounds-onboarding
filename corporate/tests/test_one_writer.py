"""One writer for the store, enforced by reading the source, not by memory."""

import ast
import unittest
from pathlib import Path

from .helpers import CORPORATE

# The whole feature, module by module.  A new module here is a deliberate act:
# this list going stale is itself a failure, so nothing can slip in unchecked.
THE_WRITER = "store.py"
THE_REST = ("rules.py", "daysheet.py", "server.py", "seed.py", "__init__.py")

# Only the writer may reach for the calls that make a write durable.
DURABLE_CALLS = ("replace", "fsync", "mkstemp")
WRITE_MODES = ("w", "a", "x", "+")


def modules():
    return sorted(p.name for p in CORPORATE.glob("*.py"))


def spells_the_folder(tree):
    """Any text in the source that names the store folder as a path."""
    guilty = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            parts = node.value.replace("\\", "/").split("/")
            if "data" in parts:
                guilty.append(node.value)
    return guilty


def durable_writes(tree):
    """Calls that put bytes on the disk, or open a file for writing."""
    guilty = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = ""
        if isinstance(node.func, ast.Attribute):
            name = node.func.attr
        elif isinstance(node.func, ast.Name):
            name = node.func.id
        if name in DURABLE_CALLS:
            guilty.append(name)
        if name in ("write_text", "write_bytes", "rmtree", "unlink"):
            guilty.append(name)
        if name == "open":
            mode = ""
            for index, argument in enumerate(node.args):
                if index == 1 and isinstance(argument, ast.Constant):
                    mode = str(argument.value)
            for keyword in node.keywords:
                if keyword.arg == "mode" and isinstance(keyword.value, ast.Constant):
                    mode = str(keyword.value.value)
            if any(letter in mode for letter in WRITE_MODES):
                guilty.append("open(%r)" % mode)
    return guilty


class OneWriter(unittest.TestCase):
    def test_the_list_of_modules_is_still_the_whole_feature(self):
        self.assertEqual(modules(), sorted((THE_WRITER,) + THE_REST),
                         "a module was added or removed — check it against this rule "
                         "and then update the list")

    def test_nobody_but_the_writer_names_the_store_folder(self):
        for name in THE_REST:
            tree = ast.parse((CORPORATE / name).read_text(encoding="utf-8"))
            self.assertEqual(spells_the_folder(tree), [],
                             "%s names the store folder; it must go through the writer"
                             % name)

    def test_nobody_but_the_writer_puts_bytes_on_the_disk(self):
        for name in THE_REST:
            tree = ast.parse((CORPORATE / name).read_text(encoding="utf-8"))
            self.assertEqual(durable_writes(tree), [],
                             "%s writes a file itself; it must go through the writer"
                             % name)

    def test_the_writer_really_is_the_one_doing_it(self):
        tree = ast.parse((CORPORATE / THE_WRITER).read_text(encoding="utf-8"))
        self.assertTrue(spells_the_folder(tree))
        self.assertTrue(durable_writes(tree))

    def test_this_check_can_actually_see_a_break(self):
        """Poison a copy of a clean module and watch both eyes open."""
        clean = (CORPORATE / "rules.py").read_text(encoding="utf-8")
        poisoned = clean + (
            '\n\ndef sneak(root):\n'
            '    with open(root / "data" / "events" / "x.json", "w") as out:\n'
            '        out.write("{}")\n')
        tree = ast.parse(poisoned)
        self.assertIn("data", " ".join(spells_the_folder(tree)))
        self.assertTrue(durable_writes(tree))
        self.assertEqual(spells_the_folder(ast.parse(clean)), [])
        self.assertEqual(durable_writes(ast.parse(clean)), [])
