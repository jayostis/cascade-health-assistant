// What the tests of PodApi and of the server share to make and lock an encrypted pod. It is no test file.
import { join } from "node:path";
import { openPod } from "cascade-runtime";
import { nodeHost } from "../node-host.ts";
import { podApi } from "../pod-api.ts";

export type Api = ReturnType<typeof podApi>;

/** A PodApi over `folder`, with `samples` the names a host copies a sample for; `opened.calls` counts the pods it is asked to open. */
export function apiOver(
  folder: string,
  samples: string[] = [],
  opened = { calls: 0 },
): Api {
  const host = nodeHost({ folder });
  return podApi({
    ...host,
    pods: {
      ...host.pods,
      open: (name, options) => {
        opened.calls += 1;
        return host.pods.open(name, options);
      },
    },
    samples,
    copySample: async (name: string) => openPod(join(folder, name)),
  });
}

/** Makes an encrypted pod for `person` through `api`, as the page does, and gives its six words. */
export async function seal(api: Api, person: string, pod: string) {
  await api.makePod({ person, encrypt: true });
  const { words } = await api.waitingWords({ pod });
  const asked = words.split(" ");
  await api.confirmWords({
    pod,
    word2: asked[1],
    word5: asked[4],
    password: words,
    username: pod,
  } as never);
  return words;
}
