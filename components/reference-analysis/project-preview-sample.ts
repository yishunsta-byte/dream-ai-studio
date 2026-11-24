// T272 Studio 합성 체험의 프로젝트 적용 미리보기 표본.
// 고정 합성 입력을 서버 전용 미리보기 계약(lib/reference-analysis/project-preview.ts)에 넣어 얻은 허용 출력만 담았다.
// 화면은 이 값을 보여 주기만 하고 소유자·프로젝트·리비전·만료를 만들거나 판정하지 않는다.
// 계약 출력과 같은지는 tests/reference-analysis/studio-project-preview.test.ts가 매번 대조한다.
import type { previewReferenceProject } from "@/lib/reference-analysis/project-preview";
import type { SampleId } from "./lab-model";

export type ProjectProposal = Extract<ReturnType<typeof previewReferenceProject>, { status: "ready" }>["proposals"][number];

export const PROJECT_PREVIEW_SAMPLE: Readonly<Record<SampleId, readonly ProjectProposal[]>> = {
  "video": [
    {
      "selectionId": "video-frame-1",
      "media": "video",
      "sourceSeek": {
        "kind": "observed_pts",
        "ptsMs": 0,
        "findingId": "video-frame-1"
      },
      "observations": [
        {
          "kind": "observation",
          "findingId": "video-frame-1",
          "measure": "decoded_frame",
          "location": {
            "kind": "time",
            "startMs": 0,
            "endMs": 0
          }
        }
      ],
      "draft": {
        "kind": "creative_proposal",
        "target": "cut",
        "editGridApproximation": {
          "fps": 30,
          "frame": 0
        },
        "prompt": "이 관찰 시점을 참고해 사용자 소재의 핵심 장면을 보여 주는 쇼트를 구성하세요."
      }
    },
    {
      "selectionId": "video-frame-2",
      "media": "video",
      "sourceSeek": {
        "kind": "observed_pts",
        "ptsMs": 120,
        "findingId": "video-frame-2"
      },
      "observations": [
        {
          "kind": "observation",
          "findingId": "video-frame-2",
          "measure": "decoded_frame",
          "location": {
            "kind": "time",
            "startMs": 120,
            "endMs": 120
          }
        }
      ],
      "draft": {
        "kind": "creative_proposal",
        "target": "cut",
        "editGridApproximation": {
          "fps": 30,
          "frame": 4
        },
        "prompt": "이 관찰 시점을 참고해 사용자 소재의 핵심 장면을 보여 주는 쇼트를 구성하세요."
      }
    },
    {
      "selectionId": "video-frame-3",
      "media": "video",
      "sourceSeek": {
        "kind": "observed_pts",
        "ptsMs": 340,
        "findingId": "video-frame-3"
      },
      "observations": [
        {
          "kind": "observation",
          "findingId": "video-frame-3",
          "measure": "decoded_frame",
          "location": {
            "kind": "time",
            "startMs": 340,
            "endMs": 340
          }
        }
      ],
      "draft": {
        "kind": "creative_proposal",
        "target": "cut",
        "editGridApproximation": {
          "fps": 30,
          "frame": 10
        },
        "prompt": "이 관찰 시점을 참고해 사용자 소재의 핵심 장면을 보여 주는 쇼트를 구성하세요."
      }
    },
    {
      "selectionId": "video-cut-1",
      "media": "video",
      "sourceSeek": {
        "kind": "observed_pts",
        "ptsMs": 340,
        "findingId": "video-frame-3"
      },
      "observations": [
        {
          "kind": "observation",
          "findingId": "video-difference-1",
          "measure": "adjacent_rgb_mean_difference",
          "location": {
            "kind": "time",
            "startMs": 120,
            "endMs": 340
          },
          "score": 0.68
        },
        {
          "kind": "observation",
          "findingId": "video-frame-3",
          "measure": "decoded_frame",
          "location": {
            "kind": "time",
            "startMs": 340,
            "endMs": 340
          }
        }
      ],
      "inference": {
        "kind": "inference",
        "findingId": "video-cut-1",
        "measure": "candidate_cut",
        "location": {
          "kind": "time",
          "startMs": 120,
          "endMs": 340
        },
        "evidenceIds": [
          "video-difference-1",
          "video-frame-3"
        ]
      },
      "draft": {
        "kind": "creative_proposal",
        "target": "cut",
        "transition": {
          "type": "cut",
          "durationFrames": 0
        },
        "editGridApproximation": {
          "fps": 30,
          "frame": 10
        },
        "prompt": "사용자 소재에서 화면 변화가 큰 지점을 골라 앞뒤 쇼트를 바로 연결하세요."
      }
    }
  ],
  "music": [
    {
      "selectionId": "audio-rms",
      "media": "music",
      "observations": [
        {
          "kind": "observation",
          "findingId": "audio-rms",
          "measure": "normalized_full_scale_rms",
          "location": {
            "kind": "time",
            "startMs": 0,
            "endMs": 500
          },
          "channels": 1,
          "peakRms": 0.2
        }
      ],
      "draft": {
        "kind": "creative_proposal",
        "target": "music",
        "role": "music",
        "prompt": "사용자 장면의 강조 지점에 맞춰 배경 음악의 셈여림을 구성하세요."
      }
    }
  ],
  "image": [
    {
      "selectionId": "image-region-0",
      "media": "image",
      "observations": [
        {
          "kind": "observation",
          "findingId": "image-region-0",
          "measure": "region_color_luminance",
          "location": {
            "kind": "region",
            "x": 0,
            "y": 0,
            "width": 1,
            "height": 1
          },
          "alphaCoverage": 1,
          "palette": [
            {
              "bucket": "#dbe4ee",
              "visibleShare": 0.6
            },
            {
              "bucket": "#a7e3d6",
              "visibleShare": 0.4
            }
          ],
          "luminanceShares": [
            0,
            0,
            0.1,
            0.9
          ],
          "luminanceEdges": [
            0,
            0.25,
            0.5,
            0.75,
            1
          ]
        }
      ],
      "draft": {
        "kind": "creative_proposal",
        "target": "image",
        "prompt": "사용자 소재에 밝은 명도를 중심으로 한 구도를 적용하세요. 화면의 왼쪽 0%, 위쪽 0% 지점부터 너비 100%, 높이 100% 영역에 #dbe4ee, #a7e3d6 계열의 색을 배치하세요."
      }
    },
    {
      "selectionId": "image-region-1",
      "media": "image",
      "observations": [
        {
          "kind": "observation",
          "findingId": "image-region-1",
          "measure": "region_color_luminance",
          "location": {
            "kind": "region",
            "x": 0.25,
            "y": 0.2,
            "width": 0.5,
            "height": 0.55
          },
          "alphaCoverage": 1,
          "palette": [
            {
              "bucket": "#a7e3d6",
              "visibleShare": 1
            }
          ],
          "luminanceShares": [
            0,
            0,
            0,
            1
          ],
          "luminanceEdges": [
            0,
            0.25,
            0.5,
            0.75,
            1
          ]
        }
      ],
      "draft": {
        "kind": "creative_proposal",
        "target": "image",
        "prompt": "사용자 소재에 밝은 명도를 중심으로 한 구도를 적용하세요. 화면의 왼쪽 25%, 위쪽 20% 지점부터 너비 50%, 높이 55% 영역에 #a7e3d6 계열의 색을 배치하세요."
      }
    }
  ]
};

// 서버 계약이 이 합성 입력에서 고를 수 있다고 판정한 근거(응답은 고른 순서를 따른다).
export const PROJECT_PREVIEW_SELECTABLE: Readonly<Record<SampleId, readonly string[]>> = {"video": ["video-frame-1", "video-frame-2", "video-frame-3", "video-cut-1"], "music": ["audio-rms"], "image": ["image-region-0", "image-region-1"]};
