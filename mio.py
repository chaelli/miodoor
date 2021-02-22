import os
import io
import time
import numpy as np
import jsonpickle
from PIL import Image
from flask import Flask, request, Response


import edgetpu.classification.engine



# Initialize the Flask application
app = Flask(__name__)

# initialize ai
model = './edgemodel/models_edge_ICN7519559552275459553_2019-08-15_18-34-56-018_edgetpu-tflite_edgetpu_model.tflite'
labels = './edgemodel/models_edge_ICN7519559552275459553_2019-08-15_18-34-56-018_edgetpu-tflite_dict.txt'

with open(labels, 'r') as f:
	pairs = (l.strip().split(maxsplit=1) for l in f.readlines())
	labels = dict((int(k), v) for k, v in pairs)

engine = edgetpu.classification.engine.ClassificationEngine(model)
_, width, height, channels = engine.get_input_tensor_shape()

imageWidth = 640
imageHeight = 480

# route http posts to this method
@app.route('/api/image', methods=['POST'])
def image():
	largeImage = Image.open(request.data)
	smallImage = largeImage.resize((width, height))
	
	results = engine.ClassifyWithInputTensor(np.array(smallImage).reshape(width*height*3), top_k=3)
	
	catValue = 0
	mouseValue = 0
	for result in results:
		if labels[result[0]] == "cat":
			catValue = result[1]
		if labels[result[0]] == "mouse":
			mouseValue = result[1]
	
	# build a response dict to send back to client
	response = {'tags': {'mouse': float(mouseValue), 'cat': float(catValue)}}
	# encode response using jsonpickle
	response_pickled = jsonpickle.encode(response)

	return Response(response=response_pickled, status=200, mimetype="application/json")


# start flask app
app.run(host="0.0.0.0", port=5000)
