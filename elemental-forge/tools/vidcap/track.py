# Markerless motion capture, step 1: MediaPipe Pose Landmarker (heavy) over a video, every frame.
# Writes per frame the 33 world landmarks (metres, hip-centred, estimated depth), their visibility, and the 2D image
# landmarks, to an .npz. Usage: python track.py <video> <model.task> <out.npz> [start_s] [end_s]
import sys, numpy as np, cv2, mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
vid, model, out = sys.argv[1], sys.argv[2], sys.argv[3]
t0 = float(sys.argv[4]) if len(sys.argv) > 4 else 0; t1 = float(sys.argv[5]) if len(sys.argv) > 5 else 1e9
opts = vision.PoseLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.VIDEO,
  num_poses=1, min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5, min_tracking_confidence=0.5)
cap = cv2.VideoCapture(vid); fps = cap.get(cv2.CAP_PROP_FPS) or 25
cap.set(cv2.CAP_PROP_POS_MSEC, t0 * 1000)
W, I, V, T = [], [], [], []
with vision.PoseLandmarker.create_from_options(opts) as lm:
  i = 0
  while True:
    ok, fr = cap.read()
    if not ok: break
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
    if t > t1: break
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
    r = lm.detect_for_video(img, int(t * 1000))
    if r.pose_world_landmarks:
      W.append([[p.x, p.y, p.z] for p in r.pose_world_landmarks[0]]); V.append([p.visibility for p in r.pose_world_landmarks[0]])
      I.append([[p.x, p.y, p.z] for p in r.pose_landmarks[0]])
    else:
      W.append(np.full((33, 3), np.nan).tolist()); V.append([0] * 33); I.append(np.full((33, 3), np.nan).tolist())
    T.append(t); i += 1
    if i % 500 == 0: print('frame', i, 't', round(t, 1), flush=True)
np.savez_compressed(out, world=np.array(W, np.float32), img=np.array(I, np.float32), vis=np.array(V, np.float32), t=np.array(T, np.float32), fps=fps)
print('done', len(T), 'frames', 'missing', int(np.isnan(np.array(W)[:, 0, 0]).sum()))
