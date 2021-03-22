import os
import io
import time
import numpy as np
import jsonpickle
from PIL import Image
from flask import Flask, request, Response


import pathlib
from pycoral.utils import edgetpu
from pycoral.utils import dataset
from pycoral.adapters import common
from pycoral.adapters import classify



# Initialize the Flask application
app = Flask(__name__)

# Specify the TensorFlow model, labels, and image
script_dir = pathlib.Path(__file__).parent.absolute()
model_file = os.path.join(script_dir, '/home/pi/edgemodel/20191110/edgetpu_model.tflite')
label_file = os.path.join(script_dir, '/home/pi/edgemodel/20191110/dict.txt')

# Initialize the TF interpreter
interpreter = edgetpu.make_interpreter(model_file)
labels = dataset.read_label_file(label_file)

running = False

# route http posts to this method
@app.route('/api/image', methods=['POST'])
def image():
	global running
	global labels
	global interpreter

	if running:
		return Response(response="{}", status=429 , mimetype="application/json")
	
	running = True
	# Run an inference
	interpreter.allocate_tensors()
	size = common.input_size(interpreter)
	image = Image.open(request.data).convert('RGB').resize(size, Image.ANTIALIAS)
	common.set_input(interpreter, image)
	
	interpreter.invoke()
	classes = classify.get_classes(interpreter, top_k=3)
	
	nomouseValue = 0
	mouseValue = 0

	# Print the result
	for c in classes:
		label = labels.get(c.id, c.id)
		score = c.score
		if label == "nomouse":
			nomouseValue = score
		if label == "mouse":
			mouseValue = score

	running = False
	# build a response dict to send back to client
	response = {'tags': {'mouse': float(mouseValue), 'nomouse': float(nomouseValue)}}
	# encode response using jsonpickle
	response_pickled = jsonpickle.encode(response)


	return Response(response=response_pickled, status=200, mimetype="application/json")


# start flask app
app.run(host="0.0.0.0", port=5000)
