"use client";

import { BlockContentPlayer } from "@/components/lesson/block-content-player";
import { VideoPlayer } from "@/components/lesson/video-player";
import { SimpleMediaPlayer } from "@/components/lesson/simple-media-player";
import { ChecklistPlayer } from "@/components/lesson/checklist-player";
import { QuizPlayer } from "@/components/lesson/quiz-player";
import { FlashcardsPlayer } from "@/components/lesson/flashcards-player";
import { ScenarioPlayer } from "@/components/lesson/scenario-player";
import { SurveyPlayer } from "@/components/lesson/survey-player";
import { AcknowledgementPlayer } from "@/components/lesson/acknowledgement-player";
import { ManagerSignoffPlayer } from "@/components/lesson/manager-signoff-player";
import { AssignmentProjectPlayer } from "@/components/lesson/assignment-project-player";
import { LiveSessionPlayer } from "@/components/lesson/live-session-player";
import { DiscussionPlayer } from "@/components/lesson/discussion-player";
import type { LessonPlayerProps } from "@/components/lesson/types";

/**
 * Dispatches to the one player that owns each LessonType. Every value of the
 * LessonType enum is handled explicitly — the default branch only guards
 * against a future enum addition this file hasn't caught up with yet.
 */
export function LessonPlayer(props: LessonPlayerProps) {
  switch (props.lesson.type) {
    case "RICH_TEXT":
    case "SOP_REF":
    case "FLOWCHART":
      return <BlockContentPlayer {...props} />;

    case "VIDEO":
    case "AI_VIDEO":
    case "SCREEN_RECORDING":
      return <VideoPlayer {...props} />;

    case "AUDIO":
    case "DOCUMENT":
    case "PRESENTATION":
    case "IMAGE":
    case "EXTERNAL_LINK":
    case "DOWNLOAD":
    case "EMBED":
      return <SimpleMediaPlayer {...props} />;

    case "CHECKLIST":
      return <ChecklistPlayer {...props} />;

    case "QUIZ":
      return <QuizPlayer {...props} />;

    case "FLASHCARDS":
      return <FlashcardsPlayer {...props} />;

    case "SCENARIO":
      return <ScenarioPlayer {...props} />;

    case "SURVEY":
      return <SurveyPlayer {...props} />;

    case "ACKNOWLEDGEMENT":
    case "SIGNATURE":
      return <AcknowledgementPlayer {...props} />;

    case "MANAGER_SIGNOFF":
    case "PRACTICAL_DEMO":
      return <ManagerSignoffPlayer {...props} />;

    case "ASSIGNMENT_PROJECT":
      return <AssignmentProjectPlayer {...props} />;

    case "LIVE_SESSION":
      return <LiveSessionPlayer {...props} />;

    case "DISCUSSION":
      return <DiscussionPlayer {...props} />;

    default:
      return (
        <p className="text-[0.875rem] text-[var(--text-muted)]">
          This lesson type isn't supported yet.
        </p>
      );
  }
}
