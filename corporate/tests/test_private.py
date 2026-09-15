"""Private things must be ABSENT from a client's answer, not merely hidden."""

import json

from .helpers import ServerCase


class Private(ServerCase):
    def setUp(self):
        super().setUp()
        self.event, links = self.plant()
        self.event_id = self.event["event_id"]
        self.token = {role: link.rsplit("/", 1)[1] for _, role, link in links}
        self.dj = self.store.access("dj")["token"]
        self.secret = self.store.load_event(self.event_id)["dj_notes"]
        self.assertTrue(self.secret, "the fixture must carry a private note to prove this")

    def _client_text(self, door, token_role="approver"):
        code, body = self.call(door, token=self.token[token_role], raw=True)
        self.assertEqual(code, 200, door)
        return body

    def test_miles_notes_are_in_his_own_reading(self):
        code, body = self.call("/api/events/%s" % self.event_id, token=self.dj)
        self.assertEqual(body["dj_notes"], self.secret)

    def test_miles_notes_are_nowhere_in_the_clients_reading(self):
        for door in ("/api/events/%s" % self.event_id,
                     "/api/events/%s/brief" % self.event_id,
                     "/api/events/%s/changes?since=0" % self.event_id):
            text = self._client_text(door)
            self.assertNotIn(self.secret, text, door)
            self.assertNotIn("dj_notes", text, door)
            self.assertNotIn("do not show the client", text.lower(), door)

    def test_one_person_never_sees_another_persons_phone_or_email(self):
        body = json.loads(self._client_text("/api/events/%s" % self.event_id, "contact"))
        me = [p for p in body["people"] if p["person_id"] == "p_mina"][0]
        self.assertEqual(me["email"], "mina@example.com")
        self.assertEqual(me["phone"], "555-0155")
        others = json.dumps([p for p in body["people"] if p["person_id"] != "p_mina"])
        self.assertNotIn("theo@example.com", others)
        self.assertNotIn("jules@example.com", others)
        self.assertNotIn("555-0119", others)
        self.assertNotIn("555-0108", others)
        for person in body["people"]:
            if person["person_id"] != "p_mina":
                self.assertEqual(person["email"], "")
                self.assertEqual(person["phone"], "")

    def test_a_change_to_the_people_list_never_carries_another_persons_details(self):
        """Found by the third outside review: the history line for a people
        change held whole records, emails and phones included, and any client
        of the event could read it."""
        event = self.store.load_event(self.event_id)
        people = json.loads(json.dumps(event["people"]))
        people.append({"person_id": "p_new", "name": "Rowan Ellis", "role": "contact",
                       "email": "rowan@example.com", "phone": "555-0199", "decides": []})
        code, body = self.call("/api/events/%s/save" % self.event_id, token=self.token["approver"],
                               body={"base_revision": event["revision"], "submission_id": "sub_people",
                                     "people": people})
        self.assertEqual(code, 200, body)
        history = json.loads(self._client_text("/api/events/%s/changes?since=0" % self.event_id, "contact"))
        people_lines = [c for c in history["changes"] if c["field"] == "people"]
        self.assertEqual(len(people_lines), 1, "the change itself must still be in the history")
        line = json.dumps(people_lines[0])
        for secret in ("theo@example.com", "jules@example.com", "rowan@example.com",
                       "555-0119", "555-0108", "555-0199"):
            self.assertNotIn(secret, line)
        self.assertIn("mina@example.com", line)          # their own row stays theirs
        # the new person's details live only in the people list, so nowhere at all
        whole = json.dumps(history)
        self.assertNotIn("rowan@example.com", whole)
        self.assertNotIn("555-0199", whole)
        code, mine = self.call("/api/events/%s/changes?since=0" % self.event_id, token=self.dj)
        self.assertIn("rowan@example.com", json.dumps(mine))   # Miles still sees everything

    def test_the_answers_the_clients_own_side_typed_still_read_back(self):
        """The form has to show a client what they wrote, or it cannot be reviewed.

        The contract's privacy line is Miles's notes and the OTHER people's
        rows in the contact list — not the answers the client supplied.
        """
        body = json.loads(self._client_text("/api/events/%s" % self.event_id, "contact"))
        self.assertEqual(body["answers"]["contact_email"]["value"], "theo@example.com")
        self.assertEqual(body["answers"]["guest_count"]["value"], "220")

    def test_names_and_roles_still_reach_the_client(self):
        body = json.loads(self._client_text("/api/events/%s" % self.event_id, "contact"))
        pairs = {(p["name"], p["role"]) for p in body["people"]}
        self.assertIn(("Theo Marsh", "approver"), pairs)
        self.assertIn(("Jules Okafor", "planner"), pairs)

    def test_a_note_miles_wrote_on_a_proposal_does_not_travel(self):
        self.store.save(self.event_id, "p_miles", "dj", {
            "base_revision": self.store.load_event(self.event_id)["revision"],
            "submission_id": "sub_note",
            "answers": {"crowd_notes": {"value": "Miles's own read.",
                                        "state": "confirmed"}}})
        event = self.store.load_event(self.event_id)
        event["answers"]["crowd_notes"]["proposal"] = {
            "value": "x", "state": "confirmed", "by": "p_miles",
            "at": "2026-09-14T00:00:00Z",
            "note": "Theo is wrong about this, handle it gently."}
        self.store._write_json(self.store._safe(self.event_id), event)
        text = self._client_text("/api/events/%s" % self.event_id)
        self.assertNotIn("handle it gently", text)
        code, mine = self.call("/api/events/%s" % self.event_id, token=self.dj)
        self.assertIn("handle it gently",
                      mine["answers"]["crowd_notes"]["proposal"]["note"])

    def test_the_client_has_no_door_to_the_sheets_that_carry_it(self):
        for door in ("/api/events/%s/daysheet" % self.event_id,
                     "/api/events/%s/daysheet.csv" % self.event_id):
            code, body = self.call(door, token=self.token["approver"], raw=True)
            self.assertEqual(code, 403, door)
            self.assertNotIn(self.secret, str(body), door)

    def test_the_day_sheet_is_for_miles_and_does_carry_the_contacts(self):
        code, page = self.call("/api/events/%s/daysheet" % self.event_id,
                               token=self.dj, raw=True)
        self.assertIn("theo@example.com", page)
        self.assertIn("555-0119", page)

    def test_words_a_client_typed_cannot_become_markup(self):
        self.store.save(self.event_id, "p_miles", "dj", {
            "base_revision": self.store.load_event(self.event_id)["revision"],
            "submission_id": "sub_html",
            "answers": {"crowd_notes": {
                "value": "<script>alert('hi')</script> & loud",
                "state": "confirmed"}}})
        code, page = self.call("/api/events/%s/daysheet" % self.event_id,
                               token=self.dj, raw=True)
        self.assertNotIn("<script>alert", page)
