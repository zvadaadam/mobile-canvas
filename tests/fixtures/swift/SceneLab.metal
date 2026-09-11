#include <metal_stdlib>
using namespace metal;

// The authored red circle becomes green only if the real Metal effect runs.
[[ stitchable ]] half4 canvasTint(float2 position, half4 color) {
  return half4(0, color.r, 0, color.a);
}
