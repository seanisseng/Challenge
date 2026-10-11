# Project Brief

This is a web application dashboard for a real-time competitive scavenger hunt game. When the game starts, a dynamic board of active challenges is presented to participating teams. To secure and complete a challenge, teams submit photo proof to the Admin for approval. Completing a challenge directly unlocks a specific tier of clue to the final destination.

---

# System Architecture & Dev Notes

* **Backend & BaaS:** Python (FastAPI / Flask / Django) integrated with **Supabase**.
* **Frontend:** Any modern web framework or light stack (React, Vue, Svelte, or HTMX + Tailwind CSS).

## Supabase Core Services

* **Database (Postgres):** Stores game sessions, teams, challenge pools, submission logs, and clue mappings.
* **Supabase Realtime:** Listens to Postgres changes (`broadcast` / `db_changes`) to instantly update the shared dynamic board, claimed tasks, and unlocked clues across all player devices without polling.
* **Supabase Storage:** Public/Private bucket (e.g., `challenge-proofs`) for high-resolution team photo uploads.
* **Supabase Auth / Session Tokens:** Admin authentication and team-level session tokens for joining game rooms.

## User Roles & Capabilities

### 1. Admin

* Create and manage game sessions (Session ID / Room Code).
* Populate and edit the challenge pool, linking each challenge to a specific clue tier.
* Review real-time photo submissions from `Supabase Storage` with **Approve** or **Reject** actions.
* Monitor team progress, unlocked clue inventories, and submission history.

### 2. Players / Teams

* Join game sessions using a session code and team name.
* View the shared, dynamic challenge board updated live via **Supabase Realtime**.
* Capture and upload photo proof directly to **Supabase Storage** for specific challenges.
* Track unlocked **Tier 1, Tier 2, and Tier 3 Clues** on their private dashboard to locate the final destination.

---

# Game Mechanics

## 1. Win Condition & Clue System

The primary objective is to be the first team to reach the secret final location. There are **no points**—progress is driven entirely by acquiring clues. Teams are free to rush to the final location at any point using whatever partial clues they have unlocked, but doing so carries the risk of heading in the wrong direction.

Clues are split into **3 Tiers of Precision**:

* **Tier 1 Clues (Macro Direction):** Broad geographic or regional hints (e.g., general neighborhood, area history, wide-angle district photo). Gives teams a general vector to head towards.
* **Tier 2 Clues (Landmark Anchors):** Narrowed search boundaries referencing specific street intersections, distinctive architectural features, or neighboring landmarks.
* **Tier 3 Clues (Precision Pins):** Absolute clarity (e.g., exact GPS coordinates, precise landmark spot, or close-up photo of the final target). Eliminates all guesswork.

## 2. Direct Clue Rewards

Every challenge on the board is explicitly bound to a clue tier:

* Completing a **Tier 1 Challenge** unlocks a Tier 1 Clue.
* Completing a **Tier 2 Challenge** unlocks a Tier 2 Clue.
* Completing a **Tier 3 Challenge** unlocks a Tier 3 Clue.

*(Teams collect clues in their team feed as soon as the Admin approves the submission).*

## 3. Challenge Properties

Each task on the dynamic board includes:

* 📍 **Location / Area:** Specific physical site or general area where the task takes place.
* 🎯 **Completion Condition:** Exact photo requirement (e.g., *"Find a banana tree and eat a banana as a group beneath it"*).
* 🔑 **Clue Tier Reward:** Explicitly shows whether the task unlocks a **Tier 1**, **Tier 2**, or **Tier 3** clue.
* 🔓 **Status:** `Open`, `Pending Approval`, or `Claimed`.

## 4. Dynamic Board & Sniping Mechanics

* **Shared Pool:** The board displays a set number of live challenges (e.g., 6 active tasks at a time) shared across all teams.
* **Sniping:** Challenges are non-exclusive until approved. When the Admin approves a photo submission, Supabase Realtime updates the task status to `Claimed`, instantly removing or locking that challenge for all rival teams.
* **Strategic Risk:** Teams must weigh task difficulty against clue value. Do you quickly secure a Tier 1 challenge for immediate directional context, or race competitors to claim a high-stakes Tier 3 challenge to skip straight to exact coordinates?