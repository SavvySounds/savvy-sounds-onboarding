"""The real doors, over real HTTP, on a private port with a private store."""

import csv
import io

from .helpers import ServerCase


class Doors(ServerCase):
    def setUp(self):
        super().setUp()
        self.event, links = self.plant()
        self.event_id = self.event["event_id"]
        self.base = self.event["revision"]
        self.token = {role: link.rsplit("/", 1)[1] for _, role, link in links}
        self.dj = self.store.access("dj")["token"]

    # --- who is knocking ---------------------------------------------------
    def test_a_foreign_host_is_turned_away_before_anything_is_routed(self):
        code, body = self.call("/api/questions", token=self.dj,
                               host="savvy-sounds.example.com")
        self.assertEqual(code, 421)
        self.assertEqual(body, {"ok": False, "error": "bad-host"})

    def test_our_own_host_gets_in(self):
        code, body = self.call("/api/questions", token=self.dj)
        self.assertEqual(code, 200)
        self.assertEqual(body["title"], "Let's set the tone for your event.")

    def test_a_post_wearing_somebody_elses_origin_is_refused(self):
        code, body = self.call("/api/events/%s/save" % self.event_id,
                               token=self.token["approver"],
                               origin="https://evil.example.com",
                               body={"base_revision": self.base,
                                     "submission_id": "sub_x", "answers": {}})
        self.assertEqual(code, 403)
        self.assertEqual(body["error"], "bad-origin")

    def test_a_post_wearing_our_own_origin_goes_through(self):
        code, body = self.call("/api/events/%s/save" % self.event_id,
                               token=self.token["approver"], origin=self.origin,
                               body={"base_revision": self.base,
                                     "submission_id": "sub_ok",
                                     "answers": {"crowd_notes": {
                                         "value": "Loud room.", "state": "confirmed"}}})
        self.assertEqual(code, 200)
        self.assertTrue(body["ok"])

    def test_the_seam_is_in_one_place(self):
        import server
        source = (server.HERE / "server.py").read_text(encoding="utf-8")
        self.assertEqual(source.count("def knock_refused"), 1)
        self.assertEqual(source.count("self.knock_refused()"), 2)

    # --- links -------------------------------------------------------------
    def test_no_link_at_all_is_refused(self):
        code, body = self.call("/api/events/%s" % self.event_id)
        self.assertEqual(code, 403)
        self.assertEqual(body["error"], "link-expired")

    def test_a_revoked_link_stops_working_on_every_door(self):
        token = self.token["approver"]
        self.store.access("revoke", token=token)
        for door in ("/api/me", "/api/events/%s" % self.event_id,
                     "/api/events/%s/brief" % self.event_id,
                     "/api/events/%s/daysheet" % self.event_id,
                     "/api/events/%s/daysheet.csv" % self.event_id):
            code, body = self.call(door, token=token)
            self.assertEqual(code, 403, door)
            self.assertEqual(body["error"], "link-expired", door)
        code, body = self.call("/api/events/%s/save" % self.event_id, token=token,
                               body={"base_revision": self.base,
                                     "submission_id": "s", "answers": {}})
        self.assertEqual(code, 403)

    def test_a_link_that_ran_out_stops_working(self):
        grant = self.store.access("mint", event_id=self.event_id,
                                  person_id="p_theo", role="approver",
                                  expires_at="2020-01-01T00:00:00Z")
        code, body = self.call("/api/me", token=grant["token"])
        self.assertEqual(code, 403)
        self.assertEqual(body["error"], "link-expired")

    def test_a_link_for_one_event_cannot_read_another(self):
        other, _ = self.plant("harbor-studio.json")
        code, body = self.call("/api/events/%s" % other["event_id"],
                               token=self.token["approver"])
        self.assertEqual(code, 403)
        self.assertEqual(body["error"], "not-your-event")

    def test_a_made_up_link_is_refused_without_saying_whether_it_exists(self):
        code, body = self.call("/api/me", token="f" * 32)
        self.assertEqual(code, 403)
        self.assertEqual(body["error"], "link-expired")

    def test_miles_reaches_every_event(self):
        self.plant("harbor-studio.json")
        code, body = self.call("/api/events", token=self.dj)
        self.assertEqual(code, 200)
        self.assertEqual(len(body), 2)
        self.assertIn("next_action", body[0])

    def test_a_client_cannot_read_the_list_of_all_events(self):
        code, body = self.call("/api/events", token=self.token["approver"])
        self.assertEqual(code, 403)
        self.assertEqual(body["error"], "not-allowed")

    def test_me_says_who_you_are(self):
        code, body = self.call("/api/me", token=self.token["planner"])
        self.assertEqual(code, 200)
        self.assertEqual(body["person"]["name"], "Jules Okafor")
        self.assertEqual(body["role"], "planner")

    # --- saving ------------------------------------------------------------
    def test_a_save_comes_back_with_a_receipt(self):
        code, body = self.call("/api/events/%s/save" % self.event_id,
                               token=self.token["approver"],
                               body={"base_revision": self.base,
                                     "submission_id": "sub_r",
                                     "answers": {"crowd_notes": {
                                         "value": "Loud room.", "state": "confirmed"}}})
        self.assertEqual(code, 200)
        self.assertEqual(body["receipt"]["revision"], self.base + 1)
        self.assertEqual(body["receipt"]["name"], "Northstar Staff Awards")
        self.assertIn("coverage", body["effects"])

    def test_sending_the_same_thing_twice_books_it_once(self):
        payload = {"base_revision": self.base, "submission_id": "sub_twice",
                   "answers": {"crowd_notes": {"value": "Loud.", "state": "confirmed"}}}
        code, first = self.call("/api/events/%s/save" % self.event_id,
                                token=self.token["approver"], body=payload)
        code2, second = self.call("/api/events/%s/save" % self.event_id,
                                  token=self.token["approver"], body=payload)
        self.assertEqual((code, code2), (200, 200))
        self.assertTrue(second["duplicate"])
        self.assertEqual(first["receipt"], second["receipt"])
        code, event = self.call("/api/events/%s" % self.event_id, token=self.dj)
        self.assertEqual(event["revision"], first["revision"])

    def test_two_editors_on_one_time_see_both_values(self):
        self.call("/api/events/%s/save" % self.event_id, token=self.token["planner"],
                  body={"base_revision": self.base, "submission_id": "sub_p",
                        "moments": [{"moment_id": "m_awards", "start": "20:45"}]})
        code, clash = self.call("/api/events/%s/save" % self.event_id, token=self.dj,
                                body={"base_revision": self.base,
                                      "submission_id": "sub_d",
                                      "moments": [{"moment_id": "m_awards",
                                                   "start": "21:00"}]})
        self.assertEqual(code, 409)
        self.assertEqual(clash["conflicts"][0]["yours"], "21:00")
        self.assertEqual(clash["conflicts"][0]["theirs"], "20:45")
        self.assertEqual(clash["conflicts"][0]["theirs_by"], "Jules Okafor")

    def test_a_contributor_can_only_propose(self):
        code, body = self.call("/api/events/%s/save" % self.event_id,
                               token=self.token["contact"],
                               body={"base_revision": self.base,
                                     "submission_id": "sub_c",
                                     "moments": [{"moment_id": "m_awards",
                                                  "start": "22:00"}]})
        self.assertEqual(code, 200)
        self.assertEqual(body["proposed"], ["moments.m_awards.start"])
        code, event = self.call("/api/events/%s" % self.event_id, token=self.dj)
        awards = [m for m in event["moments"] if m["moment_id"] == "m_awards"][0]
        self.assertEqual(awards["start"], "20:00")

    def test_sending_without_what_we_must_have_is_refused_in_words(self):
        code, body = self.call("/api/events/%s/save" % self.event_id, token=self.dj,
                               body={"base_revision": self.base,
                                     "submission_id": "sub_v", "submit": True,
                                     "answers": {"contact_email": {"value": None,
                                                                   "state": "blank"}}})
        self.assertEqual(code, 422)
        self.assertEqual(body["error"], "invalid")
        self.assertTrue(body["errors"][0]["message"])

    def test_miles_settles_the_planners_proposed_time(self):
        code, body = self.call("/api/events/%s/resolve" % self.event_id, token=self.dj,
                               body={"field": "moments.m_awards.start",
                                     "take": "proposal", "submission_id": "sub_res"})
        self.assertEqual(code, 200)
        code, event = self.call("/api/events/%s" % self.event_id, token=self.dj)
        awards = [m for m in event["moments"] if m["moment_id"] == "m_awards"][0]
        self.assertEqual(awards["start"], "20:15")

    def test_somebody_who_does_not_own_the_field_cannot_settle_it(self):
        code, body = self.call("/api/events/%s/resolve" % self.event_id,
                               token=self.token["contact"],
                               body={"field": "moments.m_awards.start",
                                     "take": "proposal", "submission_id": "sub_no"})
        self.assertEqual(code, 403)
        self.assertEqual(body["error"], "not-your-decision")

    def test_an_open_question_can_be_ticked_off(self):
        item = [i for i in self.event["open_items"] if i["owner"] == "approver"][0]
        code, body = self.call(
            "/api/events/%s/open-items/%s" % (self.event_id, item["item_id"]),
            token=self.token["approver"],
            body={"resolved": True, "answer": "Handled.", "submission_id": "sub_oi"})
        self.assertEqual(code, 200)
        code, event = self.call("/api/events/%s" % self.event_id, token=self.dj)
        done = [i for i in event["open_items"] if i["item_id"] == item["item_id"]][0]
        self.assertTrue(done["resolved"])

    def test_the_history_can_be_read_from_a_revision_on(self):
        self.call("/api/events/%s/save" % self.event_id, token=self.token["approver"],
                  body={"base_revision": self.base, "submission_id": "sub_hh",
                        "answers": {"crowd_notes": {"value": "Loud.",
                                                    "state": "confirmed"}}})
        code, body = self.call("/api/events/%s/changes?since=%d"
                               % (self.event_id, self.base), token=self.dj)
        self.assertEqual(code, 200)
        self.assertEqual([c["field"] for c in body["changes"]], ["answers.crowd_notes"])

    # --- starting a booking ------------------------------------------------
    def start_a_booking(self, people):
        return self.call("/api/dj/events", token=self.dj,
                         body={"name": "Harbor Studio Networking",
                               "company": "Harbor Studio", "date": "2026-10-02",
                               "tz": "America/Los_Angeles", "people": people})

    def test_a_booking_hands_back_a_link_that_opens_as_that_person(self):
        code, body = self.start_a_booking(
            [{"name": "Dana Whitfield", "role": "approver", "email": "dana@example.com"},
             {"name": "Priya Raman", "role": "contact", "email": "priya@example.com"}])
        self.assertEqual(code, 200, body)
        self.assertEqual(sorted(body["links"]), ["approver", "contact"])
        self.assertRegex(body["links"]["approver"], r"^/c/[0-9a-f]{32}$")

        token = body["links"]["approver"].rsplit("/", 1)[1]
        code, me = self.call("/api/me", token=token)
        self.assertEqual(code, 200)
        self.assertEqual(me["role"], "approver")
        self.assertEqual(me["person"]["name"], "Dana Whitfield")
        self.assertEqual(me["event_id"], body["event_id"])

        code, event = self.call("/api/events/%s" % body["event_id"], token=token)
        self.assertEqual(code, 200)
        self.assertEqual(event["answers"]["event_name"]["value"],
                         "Harbor Studio Networking")
        code, denied = self.call("/api/events/%s" % self.event_id, token=token)
        self.assertEqual(denied["error"], "not-your-event")

    def test_a_booking_needs_the_person_who_says_yes(self):
        code, body = self.start_a_booking(
            [{"name": "Priya Raman", "role": "contact", "email": "priya@example.com"}])
        self.assertEqual(code, 422)
        self.assertTrue(body["errors"][0]["message"])
        code, empty = self.start_a_booking([])
        self.assertEqual(empty["errors"][0]["field"], "people")
        code, rows = self.call("/api/events", token=self.dj)
        self.assertEqual(len(rows), 1, "a refused booking must not leave an event behind")

    def test_two_people_cannot_share_one_role_and_lose_a_link(self):
        code, body = self.start_a_booking(
            [{"name": "Dana Whitfield", "role": "approver", "email": "dana@example.com"},
             {"name": "Priya Raman", "role": "approver", "email": "priya@example.com"}])
        self.assertEqual(code, 422)
        self.assertIn("one person for each role", body["errors"][0]["message"].lower())

    def test_a_booking_refuses_a_role_it_does_not_hand_links_to(self):
        for role in ("dj", "producer", ""):
            code, body = self.start_a_booking(
                [{"name": "Dana Whitfield", "role": "approver",
                  "email": "dana@example.com"},
                 {"name": "Priya Raman", "role": role, "email": "priya@example.com"}])
            self.assertEqual(code, 422, role)

    def test_a_booking_refuses_an_email_that_is_not_one(self):
        code, body = self.start_a_booking(
            [{"name": "Dana Whitfield", "role": "approver", "email": "dana at example"}])
        self.assertEqual(code, 422)

    def test_a_person_id_is_never_the_text_that_was_typed(self):
        code, body = self.start_a_booking(
            [{"name": "../../etc/passwd", "role": "approver",
              "email": "dana@example.com"}])
        self.assertEqual(code, 200, body)
        code, event = self.call("/api/events/%s" % body["event_id"], token=self.dj)
        for person in event["people"]:
            self.assertRegex(person["person_id"], r"^p_[a-z0-9-]+x*$")

    # --- what Miles has already read ---------------------------------------
    def rowfor(self, token=None):
        code, rows = self.call("/api/events", token=token or self.dj)
        self.assertEqual(code, 200)
        return [row for row in rows if row["event_id"] == self.event_id][0]

    def a_client_saves_something(self, mark):
        code, body = self.call("/api/events/%s/save" % self.event_id,
                               token=self.token["approver"],
                               body={"base_revision": self.rowfor()["revision"],
                                     "submission_id": "sub_" + mark,
                                     "answers": {"crowd_notes": {
                                         "value": "Loud room, %s." % mark,
                                         "state": "confirmed"}}})
        self.assertEqual(code, 200, body)
        return body["revision"]

    def test_marking_an_event_as_looked_at_clears_what_changed(self):
        row = self.rowfor()
        self.assertGreater(row["changed_since_seen"], 0)
        code, body = self.call("/api/dj/seen", token=self.dj,
                               body={"event_id": self.event_id,
                                     "revision": row["revision"]})
        self.assertEqual(code, 200)
        self.assertEqual(body["dj_seen_revision"], row["revision"])
        self.assertEqual(self.rowfor()["changed_since_seen"], 0)
        self.a_client_saves_something("after")
        self.assertEqual(self.rowfor()["changed_since_seen"], 1)

    def test_the_bookmark_never_runs_past_where_the_event_is(self):
        row = self.rowfor()
        code, body = self.call("/api/dj/seen", token=self.dj,
                               body={"event_id": self.event_id, "revision": 999})
        self.assertEqual(code, 200)
        self.assertEqual(body["dj_seen_revision"], row["revision"])
        self.assertEqual(self.rowfor()["changed_since_seen"], 0)
        self.a_client_saves_something("later")
        self.assertEqual(self.rowfor()["changed_since_seen"], 1,
                         "a bookmark that ran ahead would hide this change")

    def test_the_bookmark_never_moves_back(self):
        row = self.rowfor()
        self.call("/api/dj/seen", token=self.dj,
                  body={"event_id": self.event_id, "revision": row["revision"]})
        code, body = self.call("/api/dj/seen", token=self.dj,
                               body={"event_id": self.event_id, "revision": 1})
        self.assertEqual(code, 200)
        self.assertEqual(body["dj_seen_revision"], row["revision"])
        self.assertEqual(self.rowfor()["changed_since_seen"], 0)

    def test_only_miles_says_what_miles_has_read(self):
        for role in ("approver", "planner", "contact"):
            code, body = self.call("/api/dj/seen", token=self.token[role],
                                   body={"event_id": self.event_id, "revision": 1})
            self.assertEqual(code, 403, role)
            self.assertEqual(body["error"], "not-allowed", role)
        self.assertEqual(self.rowfor()["changed_since_seen"],
                         len(self.store.read_changes(self.event_id)))

    def test_marking_an_event_nobody_minted_is_refused_in_words(self):
        code, body = self.call("/api/dj/seen", token=self.dj,
                               body={"event_id": "ev_0000000000", "revision": 1})
        self.assertEqual(code, 404)
        self.assertEqual(body["error"], "no-such-event")
        code, body = self.call("/api/dj/seen", token=self.dj,
                               body={"event_id": "../../etc/passwd", "revision": 1})
        self.assertEqual(code, 404)
        self.assertEqual(body["error"], "no-such-event")

    def test_a_revision_that_is_not_a_number_is_refused_in_words(self):
        code, body = self.call("/api/dj/seen", token=self.dj,
                               body={"event_id": self.event_id, "revision": "soon"})
        self.assertEqual(code, 422)
        self.assertEqual(body["error"], "invalid")
        self.assertTrue(body["errors"][0]["message"])

    def test_marking_it_read_is_not_a_change_to_the_event(self):
        row = self.rowfor()
        lines = len(self.store.read_changes(self.event_id))
        self.call("/api/dj/seen", token=self.dj,
                  body={"event_id": self.event_id, "revision": row["revision"]})
        self.assertEqual(self.rowfor()["revision"], row["revision"])
        self.assertEqual(len(self.store.read_changes(self.event_id)), lines)

    # --- the sheets --------------------------------------------------------
    def test_the_day_sheet_prints_the_revision_the_zone_and_the_cue_words(self):
        code, page = self.call("/api/events/%s/daysheet" % self.event_id,
                               token=self.dj, raw=True)
        self.assertEqual(code, 200)
        self.assertIn("revision %d" % self.base, page)
        self.assertIn("America/Chicago", page)
        self.assertIn("shi-VAWN", page)
        self.assertIn("please welcome your host for the evening", page)

    def test_a_client_cannot_pull_the_day_sheet(self):
        code, body = self.call("/api/events/%s/daysheet" % self.event_id,
                               token=self.token["approver"])
        self.assertEqual(code, 403)
        self.assertEqual(body["error"], "not-allowed")

    def test_the_day_sheet_says_when_a_block_runs_into_the_next_day(self):
        code, sheet = self.call("/api/events/%s/daysheet" % self.event_id, token=self.dj, raw=True)
        self.assertEqual(code, 200)
        self.assertIn("9:30 PM–12:30 AM (into the next day)", sheet)
        key_times = sheet.split("<h2>Key times</h2>", 1)[1].split("</table>", 1)[0]
        military = r"(?<![\d:])([01]\d|2[0-3]):[0-5]\d(?!\s?[AP]M)"
        self.assertRegex("hard stop 21:41", military)          # the probe has eyes
        self.assertNotRegex("12:30 AM", military)              # and is not fooled by half past midnight
        self.assertNotRegex(key_times, military)

        code, exported = self.call("/api/events/%s/daysheet.csv" % self.event_id,
                                   token=self.dj, raw=True)
        self.assertEqual(code, 200)
        rows = iter(csv.reader(io.StringIO(exported)))
        for row in rows:
            if row and row[0] == "Time":
                break
        time_cells = []
        for row in rows:
            if not row:
                break
            time_cells.append(row[0])
        self.assertNotRegex(" ".join(time_cells), military)

    def test_a_cell_that_would_run_as_a_formula_leaves_behind_a_quote(self):
        self.call("/api/events/%s/save" % self.event_id, token=self.token["planner"],
                  body={"base_revision": self.base, "submission_id": "sub_csv",
                        "moments": [{"moment_id": "m_dinner",
                                     "cue_text": "=1+1 then hit play"}]})
        code, sheet = self.call("/api/events/%s/daysheet.csv" % self.event_id,
                                token=self.dj, raw=True)
        self.assertEqual(code, 200)
        self.assertIn("'=1+1 then hit play", sheet)
        self.assertNotIn(",=1+1", sheet)

    def test_the_brief_only_carries_the_questions_this_person_owns(self):
        code, body = self.call("/api/events/%s/brief" % self.event_id,
                               token=self.token["planner"])
        self.assertEqual(code, 200)
        self.assertTrue(body["open_items"])
        self.assertEqual({i["owner"] for i in body["open_items"]}, {"planner"})
        self.assertEqual(body["header"]["name"], "Northstar Staff Awards")

    # --- pages -------------------------------------------------------------
    def test_the_private_link_opens_the_client_page(self):
        code, page = self.call("/c/%s" % self.token["approver"], raw=True)
        self.assertEqual(code, 200)
        self.assertIn("Savvy Sounds", page)

    def test_both_private_page_spellings_open(self):
        for path in ("/c", "/c/"):
            code, page = self.call(path, raw=True)
            self.assertEqual(code, 200, path)
            self.assertIn("Savvy Sounds", page, path)

    def test_unknown_revoked_and_expired_private_links_share_one_refusal(self):
        revoked = self.token["approver"]
        self.store.access("revoke", token=revoked)
        expired = self.store.access("mint", event_id=self.event_id,
                                    person_id="p_theo", role="approver",
                                    expires_at="2020-01-01T00:00:00Z")["token"]
        for token in ("f" * 32, revoked, expired):
            code, page = self.call("/c/%s" % token, raw=True)
            self.assertEqual(code, 403, token)
            self.assertIn("This link has expired", page, token)
            self.assertNotIn("<script", page, token)   # the page itself never ships

    def test_a_link_that_is_not_a_link_does_not_open_the_page(self):
        code, body = self.call("/c/not-a-real-token", raw=True)
        self.assertEqual(code, 403)

    def test_miles_page_opens(self):
        code, page = self.call("/dj/", raw=True)
        self.assertEqual(code, 200)
        self.assertIn("Savvy Sounds", page)
        self.assertIn('id="room"', page)
        # Nothing about an event is baked into the page: it asks for the pass
        # and then reads everything through the doors.
        self.assertNotIn(self.dj, page)
        self.assertNotIn(self.event_id, page)
        for part in ("/dj/dj.css", "/dj/dj.js"):
            self.assertIn(part, page, part)
            code, body = self.call(part, raw=True)
            self.assertEqual(code, 200, part)
            self.assertTrue(body.strip(), part)

    def test_a_path_cannot_climb_out_of_the_page_folders(self):
        for attempt in ("/dj/../store.py", "/client/../../VERIFY.md",
                        "/dj/..%2fstore.py"):
            code, body = self.call(attempt, raw=True)
            self.assertIn(code, (403, 404), attempt)
            self.assertNotIn("the ONLY writer", str(body), attempt)
