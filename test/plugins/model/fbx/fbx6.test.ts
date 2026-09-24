// @vitest-environment jsdom
/** FBX 6.x files carry no UniqueId; buildScene resolves objects by name.
 * Ensure the parse → buildScene → sceneToThree pipeline links geometry,
 * materials, skins and poses correctly.
 * Fixtures are inlined as base64 copies of lib-fbx test fixtures.
 */
import { describe, expect, it } from "vitest";
import { LoadingManager, Mesh, SkinnedMesh, Bone, type Object3D } from "three";
import { parseFbx } from "../../../../src/plugins/model/fbx/parse";

// lib-fbx tests/fixtures/ascii-6100-embedded.fbx
const ASCII_6100_EMBEDDED = "OyBGQlggNi4xLjAgcHJvamVjdCBmaWxlDQo7IGxpYi1mYnggdGVzdCBmaXh0dXJlOiBnZW9tZXRyeSBlbWJlZGRlZCBpbiBNb2RlbA0KDQpGQlhIZWFkZXJFeHRlbnNpb246ICB7DQoJRkJYVmVyc2lvbjogNjEwMA0KfQ0KT2JqZWN0czogIHsNCglNb2RlbDogMTAsICJNb2RlbDo6Qm94IiwgIk1lc2giIHsNCgkJVmVydGljZXM6ICo5IHsNCgkJCWE6IDAsMCwwLDEsMCwwLDAsMSwwDQoJCX0NCgkJUG9seWdvblZlcnRleEluZGV4OiAqMyB7DQoJCQlhOiAwLDEsLTMNCgkJfQ0KCQlQcm9wZXJ0aWVzNjA6ICB7DQoJCQlQcm9wZXJ0eTogIkxjbCBUcmFuc2xhdGlvbiIsICJMY2wgVHJhbnNsYXRpb24iLCAiQSsiLDEsMiwzDQoJCQlQcm9wZXJ0eTogIk9wYWNpdHkiLCAiZG91YmxlIiwgIkEiLDAuNQ0KCQl9DQoJfQ0KCURlZm9ybWVyOiAyMCwgIkRlZm9ybWVyOjpTa2luIiwgIlNraW4iIHsNCgl9DQoJVmlkZW86IDMwLCAiVmlkZW86OmltZy5wbmciLCAiIiB7DQoJfQ0KCVRleHR1cmU6IDQwLCAiVGV4dHVyZTo6aW1nLnBuZyIsICIiIHsNCgl9DQp9DQpDb25uZWN0aW9uczogIHsNCglDOiAiT08iLDIwLDEwDQp9DQo=";

// lib-fbx tests/fixtures/ascii-7400-triangle.fbx (Pose nodes without Matrix)
const ASCII_7400_TRIANGLE = "OyBGQlggNy40LjAgcHJvamVjdCBmaWxlDQo7IGxpYi1mYnggdGVzdCBmaXh0dXJlOiB0cmlhbmdsZSBtZXNoDQoNCkZCWEhlYWRlckV4dGVuc2lvbjogIHsNCglGQlhIZWFkZXJWZXJzaW9uOiAxMDAzDQoJRkJYVmVyc2lvbjogNzQwMA0KfQ0KR2xvYmFsU2V0dGluZ3M6ICB7DQoJVmVyc2lvbjogMTAwMA0KCVByb3BlcnRpZXM3MDogIHsNCgkJUDogIlVuaXRTY2FsZUZhY3RvciIsICJkb3VibGUiLCAiTnVtYmVyIiwgIiIsMQ0KCQlQOiAiVXBBeGlzIiwgImludCIsICJJbnRlZ2VyIiwgIiIsMQ0KCQlQOiAiQW1iaWVudENvbG9yIiwgIkNvbG9yUkdCIiwgIkNvbG9yIiwgIiIsMC4xLDAuMiwwLjMNCgkJUDogIkxjbCBUcmFuc2xhdGlvbiIsICJMY2wgVHJhbnNsYXRpb24iLCAiIiwgIkEiLDAsMCwwDQoJfQ0KfQ0KT2JqZWN0czogIHsNCglHZW9tZXRyeTogMTAwLCAiR2VvbWV0cnk6OlRyaWFuZ2xlIiwgIk1lc2giIHsNCgkJVmVydGljZXM6ICo5IHsNCgkJCWE6IDAsMCwwLDEsMCwwLA0KMCwxLDANCgkJfQ0KCQlQb2x5Z29uVmVydGV4SW5kZXg6ICozIHsNCgkJCWE6IDAsMSwtMw0KCQl9DQoJfQ0KCU1vZGVsOiAyMDAsICJNb2RlbDo6VHJpYW5nbGUiLCAiTWVzaCIgew0KCQlQcm9wZXJ0aWVzNzA6ICB7DQoJCQlQOiAiTGNsIFRyYW5zbGF0aW9uIiwgIkxjbCBUcmFuc2xhdGlvbiIsICIiLCAiQSsiLDEsMiwzDQoJCQlQOiAiTGNsIFJvdGF0aW9uIiwgIkxjbCBSb3RhdGlvbiIsICIiLCAiQSsiLDAsOTAsMA0KCQkJUDogIkxjbCBTY2FsaW5nIiwgIkxjbCBTY2FsaW5nIiwgIiIsICJBKyIsMSwxLDENCgkJfQ0KCX0NCglNYXRlcmlhbDogMzAwLCAiTWF0ZXJpYWw6OkRlZmF1bHQiLCAiIiB7DQoJCVNoYWRpbmdNb2RlbDogInBob25nIg0KCX0NCglQb3NlOiA0MDAsICJQb3NlOjpCaW5kUG9zZSIsICJCaW5kUG9zZSIgew0KCQlOYlBvc2VOb2RlczogMg0KCQlQb3NlTm9kZTogIHsNCgkJCU5vZGU6IDIwMA0KCQl9DQoJCVBvc2VOb2RlOiAgew0KCQkJTm9kZTogMTAwDQoJCX0NCgl9DQoJVmlkZW86IDUwMCwgIlZpZGVvOjp0ZXgiLCAiQ2xpcCIgew0KCQlDb250ZW50OiAsDQoJCQkiWm1GclpTMTBaWGc9Ig0KCX0NCn0NCkNvbm5lY3Rpb25zOiAgew0KCUM6ICJPTyIsMTAwLDIwMA0KCUM6ICJPTyIsMzAwLDIwMA0KfQ0K";

// lib-fbx tests/fixtures/binary-6100-embedded.fbx (vertices, no polygons)
const BINARY_6100_EMBEDDED = "S2F5ZGFyYSBGQlggQmluYXJ5ICAAGgDUFwAAxgEAAAAAAAAAAAAAB09iamVjdHMsAQAAAwAAACEAAAAFTW9kZWxMCgAAAAAAAABTCgAAAE1vZGVsOjpCb3hTBAAAAE1lc2i0AAAAAQAAAD0AAAAIVmVydGljZXNkBgAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8D8AAAAAAAAAAAAAAAAAAAAALAEAAAAAAAAAAAAADFByb3BlcnRpZXM2MCwBAAAGAAAASgAAAAhQcm9wZXJ0eVMPAAAATGNsIFRyYW5zbGF0aW9uUw8AAABMY2wgVHJhbnNsYXRpb25TAgAAAEErRAAAAAAAABBARAAAAAAAABRARAAAAAAAABhAZgEAAAMAAAAlAAAACERlZm9ybWVyTBQAAAAAAAAAUw4AAABEZWZvcm1lcjo6U2tpblMEAAAAU2tpbpQBAAACAAAAHAAAAAVWaWRlb0weAAAAAAAAAFMOAAAAVmlkZW86OmltZy5wbmfGAQAAAgAAAB4AAAAHVGV4dHVyZUwoAAAAAAAAAFMQAAAAVGV4dHVyZTo6aW1nLnBuZwUCAAAAAAAAAAAAAAtDb25uZWN0aW9ucwUCAAADAAAAGQAAAAFDUwIAAABPT0wUAAAAAAAAAEwKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

// lib-fbx tests/fixtures/binary-7400-triangle.fbx
const BINARY_7400_TRIANGLE = "S2F5ZGFyYSBGQlggQmluYXJ5ICAAGgDoHAAAVgAAAAAAAAAAAAAAEkZCWEhlYWRlckV4dGVuc2lvblYAAAABAAAABQAAAApGQlhWZXJzaW9uSegcAABYAgAAAAAAAAAAAAAHT2JqZWN0c3gBAAADAAAAKQAAAAhHZW9tZXRyeUxkAAAAAAAAAFMSAAAAR2VvbWV0cnk6OlRyaWFuZ2xlUwQAAABNZXNoEgEAAAEAAABVAAAACFZlcnRpY2VzZAkAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8D8AAAAAAAAAAEoBAAABAAAAGQAAABJQb2x5Z29uVmVydGV4SW5kZXhpAwAAAAAAAAAMAAAAAAAAAAEAAAD9////eAEAAAEAAAAaAAAAB05vcm1hbHNmAwAAAAEAAAANAAAAeJxjYICBBnsAAUsAwFgCAAADAAAAJgAAAAVNb2RlbEzIAAAAAAAAAFMPAAAATW9kZWw6OlRyaWFuZ2xlUwQAAABNZXNoWAIAAAAAAAAAAAAADFByb3BlcnRpZXM3MCYCAAAHAAAATwAAAAFQUw8AAABMY2wgVHJhbnNsYXRpb25TDwAAAExjbCBUcmFuc2xhdGlvblMAAAAAUwIAAABBK0QAAAAAAADwP0QAAAAAAAAAQEQAAAAAAAAIQFgCAAAFAAAAJAAAAAFQUwoAAABWaXNpYmlsaXR5UwQAAABib29sUwAAAABTAAAAAEMBlwIAAAAAAAAAAAAAC0Nvbm5lY3Rpb25zlwIAAAMAAAAZAAAAAUNTAgAAAE9PTGQAAAAAAAAATMgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// A skinned, nameless FBX 6.x model: objects are referenced by name only.
const ASCII_6100_SKINNED = `; FBX 6.1
FBXHeaderExtension:  {
	FBXVersion: 6100
}
Objects:  {
	Model: "Model::Body", "Mesh" {
		Vertices: *9 {
			a: 0,0,0,1,0,0,0,1,0
		}
		PolygonVertexIndex: *3 {
			a: 0,1,-3
		}
		LayerElementNormal: 0 {
			Version: 101
			MappingInformationType: "ByVertice"
			ReferenceInformationType: "Direct"
			Normals: *9 {
				a: 0,0,1,0,0,1,0,0,1
			}
		}
	}
	Model: "Model::Bone1", "LimbNode" {
	}
	Deformer: "Deformer::Skin Body", "Skin" {
	}
	Deformer: "SubDeformer::Cluster Bone1", "Cluster" {
		Indexes: *3 {
			a: 0,1,2
		}
		Weights: *3 {
			a: 1,1,1
		}
		TransformLink: *16 {
			a: 1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1
		}
	}
}
Connections:  {
	Connect: "OO", "Body", "Scene"
	Connect: "OO", "Bone1", "Scene"
	Connect: "OO", "Skin Body", "Body"
	Connect: "OO", "Cluster Bone1", "Skin Body"
	Connect: "OO", "Bone1", "Cluster Bone1"
}
`;

function fromBase64(data: string): ArrayBuffer {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes.buffer;
}

function fromText(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function countMeshes(root: Object3D): { meshes: number; vertices: number } {
  let meshes = 0;
  let vertices = 0;
  root.traverse(object => {
    if (object instanceof Mesh) {
      meshes += 1;
      vertices += object.geometry.getAttribute("position")?.count ?? 0;
    }
  });
  return { meshes, vertices };
}

function convert(buffer: ArrayBuffer): Object3D {
  return parseFbx(buffer, "http://localhost/", new LoadingManager(), new AbortController().signal);
}

describe("fbx 6.x display", () => {
  it("renders an ascii 6100 file with embedded geometry", () => {
    const { meshes, vertices } = countMeshes(convert(fromBase64(ASCII_6100_EMBEDDED)));
    expect(meshes).toBeGreaterThan(0);
    expect(vertices).toBeGreaterThan(0);
  });

  it("converts a binary 6100 file without polygons and does not throw", () => {
    // This synthetic fixture carries vertices but no PolygonVertexIndex;
    // it must still produce a scene node instead of crashing.
    const model = convert(fromBase64(BINARY_6100_EMBEDDED));
    expect(model.children.length).toBeGreaterThan(0);
  });

  it("binds a skinned nameless 6.x model", () => {
    const model = convert(fromText(ASCII_6100_SKINNED));
    let skinned = 0;
    let bones = 0;
    let vertices = 0;
    model.traverse(object => {
      if (object instanceof SkinnedMesh) {
        skinned += 1;
        vertices += object.geometry.getAttribute("position")?.count ?? 0;
      }
      if (object instanceof Bone) bones += 1;
    });
    expect(skinned).toBe(1);
    expect(bones).toBeGreaterThan(0);
    expect(vertices).toBe(3);
  });

  it("survives pose nodes without matrices (ascii 7400)", () => {
    const { meshes, vertices } = countMeshes(convert(fromBase64(ASCII_7400_TRIANGLE)));
    expect(meshes).toBe(1);
    expect(vertices).toBe(3);
  });

  it("keeps 7.x numeric ids untouched", () => {
    const { meshes, vertices } = countMeshes(convert(fromBase64(BINARY_7400_TRIANGLE)));
    expect(meshes).toBe(1);
    expect(vertices).toBe(3);
  });
});
